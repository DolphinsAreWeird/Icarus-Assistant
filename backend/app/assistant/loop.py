"""One chat turn: checks before, the cheapest route that can answer, checks after.

Routes, cheapest first (debug.route says which one answered):
  prepared  one of the questions people ask most, from data/prepared_answers.json (prepared.py)
  fastpath  a common request read by plain patterns and done with the tools (fastpath.py)
  cache     the same question, screen and facts, answered by the model minutes ago (memo.py)
  model     the model's tool loop, with the facts it needs already in its context
FASTPATH=0 skips the first three: every question goes to the model, as before.

Only clear requests take the first two routes. Vague, open or chatty ones ("help", "what is this?",
"is it safe?", "tell me more") go to the model, which answers about what the user is looking at.

Works with any OpenAI-compatible model (see llm.py). The system message is rebuilt every call: the
fixed rules (byte-identical, so they cache) plus this turn's context: what's on screen and what
"this" means there, the user, and the facts (the assets in play, prices, fees, their money). The
user can't edit it. After the model: no security claims (checks.security_claim), short plain replies
(checks.brief), and every number checked against the facts and tool results.
"""
import json
import os
import re
import time
from types import SimpleNamespace

from app import knowledge, ui
from app.assistant import fastpath
from app.assistant.checks import (asks_for_advice, brief, detect_language, first_sentence, first_sentences,
                                  mentioned_assets, plain_reply, security_claim, unbacked_numbers)
from app.assistant.guard import guard_text
from app.assistant.llm import ChatModel, parse_arguments
from app.assistant.memo import AnswerCache, QuestionLog, reusable, standalone
from app.assistant.normalize import normalize
from app.assistant.prepared import PreparedAnswers, default as prepared_answers, sample_questions
from app.assistant.prompt import FALLBACK_REPLY, REFUSAL_REPLY, SAFETY_REPLY, SYSTEM_PROMPT, turn_context
from app.assistant.trade_grounding import check as trade_check
from app.contracts import ChatReply, ChatRequest, SourceRef
from app.facts import FactPacks, name as asset_name
from app.market.cache import PriceCache
from app.state import DemoState
from app.tools import ToolContext, _envelope, run_tool, tool_specs

MAX_MODEL_CALLS = 6
# After this long, no further model call in the turn: answer with what the tools already said (or the fallback),
# so a stalled provider never keeps a visitor waiting 15 s or more.
ANSWER_BUDGET_S = float(os.getenv("ANSWER_BUDGET_S", "7"))
MAX_HISTORY = 16        # messages kept per session; free tiers have small token budgets
THINK_TAGS = re.compile(r"<think>.*?</think>", re.DOTALL)  # some local models think out loud
DEMO_USER = os.getenv("DEMO_USER", "u_new")  # who "demo-user" (the voice server's default) is
FEE_WORDS = re.compile(r"\bfees?\b|commission|charge|\bcost|minimum|ค่าธรรมเนียม|ขั้นต่ำ", re.IGNORECASE)
DASH = re.compile(r"\s*—\s*|\s+–\s+")  # the app's voice has no em dashes
PREWARM_SNAPSHOT = {"screen": "home", "label": "Home screen"}
REPEATED = json.dumps({"ok": False, "reason": "repeated",
                       "message": "You already did this in this turn. Now answer the user in one or two short sentences."})


class UnknownUser(Exception):
    pass


class NoModel(Exception):
    """No model is set up, and no cheaper route could answer."""


def said_by_tools(results: list[tuple[str, str]], lang: str) -> str | None:
    """The last thing this turn's tools said themselves: a screen tool's "done" (English only), an asset's
    description, or a price or a change from a data tool's own "say" text (in the reply language)."""
    th = lang == "th"
    for name, content in reversed(results):
        try:
            data = json.loads(content)
        except ValueError:
            continue
        data = data.get("data", data) if isinstance(data, dict) else {}
        if data.get("ok") and data.get("done") and lang == "en":
            return data["done"]
        if name == "get_asset_info" and data.get("description"):
            return first_sentences(data["description"], 2)
        if name == "get_history" and (data.get("say") or {}).get("change"):  # caught live: a model silent after it
            who = asset_name(data.get("asset_id"), lang)
            return f"{who}{data['say']['change']}" if th else f"{who[:1].upper() + who[1:]} is {data['say']['change']}."
        if name == "get_prices":
            for asset, p in data.items():
                say = p.get("say") if isinstance(p, dict) else None
                if say and say.get("price"):
                    who = asset_name(asset, lang)
                    return (f"{who}ราคา{say['price']} {say['change_24h']}" if th else
                            f"{who[:1].upper() + who[1:]} is {say['price']}, {say['change_24h']}.")
    return None


def trim(history: list) -> None:
    """Drop the oldest turns (each starts at a user message, so tool calls stay paired).
    The newest turn is never dropped, even if it alone is longer than MAX_HISTORY."""
    while len(history) > MAX_HISTORY:
        users = [i for i, m in enumerate(history) if m["role"] == "user"]
        if len(users) < 2:
            return
        del history[:users[1]]


class Assistant:
    def __init__(self, llm: ChatModel | None, state: DemoState, cache: PriceCache, facts: FactPacks | None = None,
                 prepared: PreparedAnswers | None = None, answers: AnswerCache | None = None,
                 log: QuestionLog | None = None):
        self.llm = llm
        self.state = state
        self.cache = cache
        self.tools = tool_specs()
        self.facts = facts or FactPacks(cache)
        self.prepared = prepared or prepared_answers()
        self.answers = answers or AnswerCache.from_env()
        self.log = log or QuestionLog(None)

    def prices_changed(self) -> None:
        """The poller calls this after each poll: the fact packs follow the prices."""
        self.facts.refresh()

    def _context(self, req: ChatRequest, user_id: str, lang: str) -> ToolContext:
        screen = req.screen_context
        ui_state = ui.state_from_snapshot(req.snapshot, screen.screen_id if screen else None,
                                          screen.selected_asset if screen else None)
        return ToolContext(self.state, self.cache, user_id, lang, screen, req.snapshot, ui_state)

    def chat(self, req: ChatRequest) -> ChatReply:
        started = time.perf_counter()
        user_id = req.user_id
        if user_id not in self.state.users and (user_id == "demo-user" or req.snapshot is not None):
            user_id = DEMO_USER
        user = self.state.users.get(user_id)
        if user is None:
            raise UnknownUser(req.user_id)

        # ---- before the model: plain code ----
        lang = detect_language(req.text, req.lang or "en")
        turn = {"lang": lang, "assets_mentioned": mentioned_assets(req.text, knowledge.assets()),
                "asks_for_advice": asks_for_advice(req.text)}
        history = self.state.sessions.setdefault(f"{user_id}:{req.session_id}", [])
        facts, norm = self.facts.current(), normalize(req.text)
        start = self._context(req, user_id, lang).ui_state
        snap_asset = ((req.snapshot or {}).get("asset") or {}).get("id")
        named = snap_asset or (req.screen_context.selected_asset if req.screen_context else None)
        here = start.asset if named and start.screen in ("asset", "buy", "buy_review") else None

        def attempt(route: str, do, **info) -> ChatReply | None:
            ctx = self._context(req, user_id, lang)  # fresh each time: a route that gives up leaves nothing behind
            done = do(ctx)
            if done is None:
                return None
            text, calls = done
            reply = self._finish(req, ctx, text, started, norm, turn | info, route=route, model_calls=calls,
                                 **self._who(calls))
            history.extend([{"role": "user", "content": req.text}, {"role": "assistant", "content": reply.text}])
            trim(history)
            return reply

        reply = None
        if fastpath.enabled():
            entry = self.prepared.match_exact(norm)
            if entry:
                reply = attempt("prepared", lambda ctx: self.prepared.answer(
                    entry, ctx, facts, lang, self.llm, here, req.text), prepared=entry["id"])
            intent = None if reply else fastpath.parse(req.text, here)
            if intent and (intent.kind == "advice" or not turn["asks_for_advice"]):
                reply = attempt("fastpath", lambda ctx: fastpath.run(intent, ctx, facts, lang, self.llm, req.text),
                                intent=intent.kind)
            entry = None if reply else self.prepared.match_near(req.text, norm)
            if entry:
                reply = attempt("prepared", lambda ctx: self.prepared.answer(
                    entry, ctx, facts, lang, self.llm, here, req.text), prepared=entry["id"], matched="near")
            if reply is None:
                reply = self._from_cache(req, user, lang, norm, start, facts, history, started, turn)
        if reply is None:
            try:
                reply = self._model(req, user, user_id, lang, norm, start, here, facts, history, started, turn)
            except Exception as e:  # the friction map wants these most of all
                self.log.write(text=req.text, norm=norm, lang=lang, screen=start.screen, route="error",
                               answer=type(e).__name__, model_calls=None,
                               latency_ms=round((time.perf_counter() - started) * 1000))
                raise
        self.log.write(text=req.text, norm=norm, lang=lang, screen=start.screen, route=reply.debug["route"],
                       answer=reply.debug.get("prepared") or reply.debug.get("intent"),
                       model_calls=reply.debug["model_calls"], latency_ms=reply.debug["latency_ms"])
        return reply

    # ---------- the model's tool loop ----------

    def _model(self, req, user, user_id, lang, norm, start, here, facts, history, started, turn) -> ChatReply:
        if self.llm is None:
            raise NoModel()
        ctx = self._context(req, user_id, lang)
        # the facts: the assets named, the one on screen, and the ones the last exchange was about ("tell me more")
        said = [next((m["content"] for m in reversed(history) if m["role"] == role and m.get("content")), "")
                for role in ("user", "assistant")]
        earlier = mentioned_assets(" ".join(said), knowledge.assets())
        app_ids = [a for a in (ui.to_app_asset(d) for d in turn["assets_mentioned"] + earlier) if a] + ([here] if here else [])
        snap = req.snapshot or {}
        period = str(snap.get("period") or (req.screen_context.chart_period if req.screen_context else None) or "").upper()
        # the chart on an asset page is our price history, unless the app draws its own demo series
        chart = (here, period) if here and start.screen == "asset" and period and snap.get("data_source") != "demo" else None
        fees = any(FEE_WORDS.search(t) for t in [req.text, *said]) or start.screen in ("buy", "buy_review")
        given, pack_envelopes = facts.for_model(app_ids, lang, fees=fees, chart=chart)
        given["their money"], money_envelopes = facts.money_for_model(user, lang, req.snapshot)
        pack_envelopes += money_envelopes
        if isinstance(snap.get("buy"), dict):  # what the user typed on the buy screen: a source when it's said
            pack_envelopes.append(_envelope(SimpleNamespace(results={}), "app_screen", snap["buy"],
                                            "app screen (typed by the user)", freshness="screen"))
        told = req.snapshot is not None or req.screen_context is not None  # the app said where the user is
        system = {"role": "system", "content": SYSTEM_PROMPT + "\n\nContext for this turn:\n"
                  + turn_context(user, lang, req.screen_context, turn["assets_mentioned"], turn["asks_for_advice"],
                                 req.snapshot, given, where=(start.screen, start.asset) if told else None,
                                 text=req.text)}
        start_len = len(history)
        first_turn = start_len == 0  # nothing said before: the answer can't lean on the conversation
        previous = next((m["content"] for m in reversed(history) if m["role"] == "user"
                         and isinstance(m.get("content"), str)), None)
        history.append({"role": "user", "content": req.text})

        text, calls, finish, used, results, done = None, 0, None, [], [], set()
        try:
            while calls < MAX_MODEL_CALLS and not (calls and time.perf_counter() - started > ANSWER_BUDGET_S):
                msg, finish = self.llm.complete([system, *history], self.tools)
                calls += 1
                if finish == "content_filter":
                    text = REFUSAL_REPLY[lang]
                    history.append({"role": "assistant", "content": text})
                    break
                history.append(dict(msg))
                if not msg.get("tool_calls"):
                    text = THINK_TAGS.sub("", msg["content"]).strip()
                    break
                for call in msg["tool_calls"]:
                    used.append(call["function"]["name"])
                    try:
                        args = parse_arguments(call["function"]["arguments"])
                        key = (call["function"]["name"], json.dumps(args, sort_keys=True))
                        # a trade preview needs the user's own words for it (asset, side, amount): checked first
                        refused = (trade_check(args, req.text, previous, here)
                                   if call["function"]["name"] == "prepare_trade" else None)
                        if refused:
                            content = json.dumps(refused)
                        else:  # caught live: a model highlighting the same thing four times in one turn
                            content = REPEATED if key in done else run_tool(ctx, call["function"]["name"], args)
                        done.add(key)
                    except Exception as e:  # a broken tool call must not break the turn
                        content = json.dumps({"error": f"{type(e).__name__}: {e}"})
                    history.append({"role": "tool", "tool_call_id": call["id"], "content": content})
                    results.append((call["function"]["name"], content))
        except Exception:
            del history[start_len:]  # drop this turn so the session stays valid
            raise
        if not text:  # the model said nothing: say what its tools did, if they said it themselves
            text = said_by_tools(results, lang) or FALLBACK_REPLY[lang]
        guard = {}
        if security_claim(req.text, text):  # rule 11 in code: no security claim we can't back, however worded
            text, guard = SAFETY_REPLY[lang], {"guard": "security_claim"}
        # a fact we gave the model is a source when it backs a number nothing before it backs
        cited, unbacked = [], unbacked_numbers(text, list(ctx.results.values()), req.text)
        for envelope in pack_envelopes:
            left = unbacked_numbers(text, [*ctx.results.values(), *cited, envelope], req.text)
            if len(left) < len(unbacked):
                cited, unbacked = cited + [envelope], left
        reply = self._finish(req, ctx, text, started, norm, turn, extra=cited, route="model", model_calls=calls,
                             finish_reason=finish, **self._who(calls), **guard)
        # Only the checked response may become conversational memory. Tool-call messages
        # retain their pairing, but their optional generated prose is never trusted.
        for message in history[start_len:]:
            if message["role"] == "assistant":
                message["content"] = "" if message.get("tool_calls") else reply.text
        if history[-1]["role"] != "assistant" or history[-1].get("tool_calls"):
            history.append({"role": "assistant", "content": reply.text})
        trim(history)
        # Only a session's first turn is kept (no history to lean on), and only a checked, ungated answer.
        if (reusable(used) and first_turn and fastpath.enabled() and standalone(norm) and finish != "content_filter"
                and text != FALLBACK_REPLY[lang] and reply.status == "ok" and not reply.debug.get("guard")):
            self.answers.put(self._cache_key(req, user, lang, norm, start, facts),
                             {"text": reply.text, "ui_actions": reply.ui_actions,
                              "sources": [s.model_dump() for s in reply.sources], "model": reply.debug["model"],
                              "grounding": [*ctx.results.values(), *cited]})
        return reply

    # ---------- the answer cache ----------

    def _cache_key(self, req, user, lang, norm, start, facts) -> tuple:
        """Everything a model answer depends on besides the question: the screen and asset, what's on it (chart
        period, tapped element, visible elements, typed amount, the snapshot's label), the facts, the journey
        stage, and whose money and how much. The model has the user's money in its context, so an answer is
        kept for that user only, while their account and the app's snapshot are unchanged: a trade (or another
        visitor's app, all mapped to the demo user) never gets an old reply. Entries exist only for a
        session's first turn (no history to lean on)."""
        screen = req.screen_context
        on_screen = ((screen.chart_period, screen.focused_element, tuple(screen.visible_elements),
                      screen.entered_amount) if screen else None)
        seen = (user["journey"]["stage"], (req.snapshot or {}).get("label"))
        money = json.dumps([req.snapshot, user], sort_keys=True, default=str)
        return norm, lang, start.screen, start.asset, on_screen, facts.version, seen, user["user_id"], money

    def _from_cache(self, req, user, lang, norm, start, facts, history, started, turn) -> ChatReply | None:
        if history or not standalone(norm):  # with history the model may have used it: never reuse
            return None
        hit = self.answers.get(self._cache_key(req, user, lang, norm, start, facts))
        if hit is None:
            return None
        # Source labels alone cannot prove a cached figure. Old entries without the
        # original tool evidence must go through the model again if they contain figures.
        if unbacked_numbers(hit["text"], hit.get("grounding", []), req.text):
            return None
        history.extend([{"role": "user", "content": req.text}, {"role": "assistant", "content": hit["text"]}])
        trim(history)
        return ChatReply(text=hit["text"], speak=req.input_mode == "voice", ui_actions=hit["ui_actions"],
                         sources=[SourceRef(**s) for s in hit["sources"]],
                         debug=turn | {"route": "cache", "model_calls": 0, "model": None, "provider": None,
                                       "answered_by": hit["model"], "finish_reason": None,
                                       "screen_after": None, "asset_after": None, "unbacked_numbers": [],
                                       "latency_ms": round((time.perf_counter() - started) * 1000)})

    # ---------- after any route: plain code ----------

    def _who(self, calls: int) -> dict:
        """Who answered: the model that actually did (not the whole chain), or nobody."""
        if not calls or self.llm is None:
            return {"provider": None, "model": None}
        return {"provider": getattr(self.llm, "last_provider", None) or self.llm.provider,
                "model": getattr(self.llm, "last_model", None) or self.llm.model}

    def _finish(self, req, ctx, text, started, norm, turn, extra=(), **debug) -> ChatReply:
        envelopes = list(ctx.results.values()) + list(extra)
        # advice or "it's bought" never reaches the user, whichever route wrote it; checked on the whole reply
        # first, so the rule it broke is the one reported (the safe sentences carry no figures)
        text, broke_rule = guard_text(text, ctx.lang)
        unbacked = unbacked_numbers(text, envelopes, req.text)
        if unbacked:
            text = ("I can't verify those figures. Please ask for a current price or account summary."
                    if turn["lang"] == "en" else
                    "ยังตรวจสอบตัวเลขเหล่านั้นไม่ได้ กรุณาถามราคาหรือสรุปบัญชีอีกครั้ง")
            ctx.ui_actions = []
        text = plain_reply(DASH.sub(", ", text), ctx.lang)
        ctx.ui_actions = ui.finalize(ctx.ui_actions)
        cards = {a["card_type"] for a in ctx.ui_actions if a["type"] == "card"}
        if cards & {"chart", "steps"}:
            text = first_sentence(text)  # the card shows the details; say just the headline
        elif "trade_preview" not in cards:
            text = brief(text, ctx.lang)  # never long; a trade keeps its "tap Confirm"
        text, late = guard_text(text, ctx.lang)  # and again on what is actually said, after trimming
        broke_rule = broke_rule or late
        for action in ctx.ui_actions:  # last gate: only the closed set ever leaves the backend
            ui.validate(action)
        return ChatReply(
            text=text,
            status="unavailable" if unbacked else "ok",
            speak=req.input_mode == "voice",
            ui_actions=ctx.ui_actions,
            sources=[SourceRef(result_id=e["result_id"], tool=e["tool"], **e["source"]) for e in envelopes],
            debug=turn | {"finish_reason": None} | debug | {
                "screen_after": ctx.ui_state.screen, "asset_after": ctx.ui_state.asset, "guard": broke_rule or debug.get("guard"),
                "unbacked_numbers": unbacked,
                "latency_ms": round((time.perf_counter() - started) * 1000)},
        )

    # ---------- warming up ----------

    def prewarm(self) -> int:
        """Answer every prepared question once, on a scratch account and with no model, so the first
        visitor doesn't pay for cold caches. Returns how many answered without the model."""
        scratch = Assistant(None, DemoState(), self.cache, self.facts, self.prepared, AnswerCache(0), QuestionLog(None))
        answered = 0
        for text, lang in sample_questions():
            try:
                scratch.chat(ChatRequest(session_id="prewarm", user_id="u_new", text=text, lang=lang,
                                         snapshot=PREWARM_SNAPSHOT))
                answered += 1
            except Exception:  # noqa: BLE001  NoModel, or anything else: warming must never stop the server
                pass
        return answered
