"""One chat turn: checks before, the model's tool loop, checks after.

Works with any OpenAI-compatible model (see llm.py). The system message is rebuilt
every call: fixed rules plus this turn's screen context. The user can't edit it.
"""
import json
import os
import re
import time

from app import knowledge, ui
from app.assistant.checks import asks_for_advice, detect_language, mentioned_assets, unbacked_numbers
from app.assistant.llm import ChatModel, parse_arguments
from app.assistant.prompt import FALLBACK_REPLY, REFUSAL_REPLY, SYSTEM_PROMPT, turn_context
from app.contracts import ChatReply, ChatRequest, SourceRef
from app.market.cache import PriceCache
from app.state import DemoState
from app.tools import ToolContext, run_tool, tool_specs

MAX_MODEL_CALLS = 6
MAX_HISTORY = 16        # messages kept per session; free tiers have small token budgets
THINK_TAGS = re.compile(r"<think>.*?</think>", re.DOTALL)  # some local models think out loud
DEMO_USER = os.getenv("DEMO_USER", "u_new")  # who "demo-user" (the voice server's default) is


class UnknownUser(Exception):
    pass


def trim(history: list) -> None:
    """Drop old messages, but always start at a user message so tool calls stay paired."""
    while len(history) > MAX_HISTORY:
        del history[0]
        while history and history[0]["role"] != "user":
            del history[0]


class Assistant:
    def __init__(self, llm: ChatModel, state: DemoState, cache: PriceCache):
        self.llm = llm
        self.state = state
        self.cache = cache
        self.tools = tool_specs()

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
        mentioned = mentioned_assets(req.text, knowledge.assets())
        advice = asks_for_advice(req.text)
        system = {"role": "system", "content": SYSTEM_PROMPT + "\n\nContext for this turn:\n"
                  + turn_context(user, lang, req.screen_context, mentioned, advice, req.snapshot)}
        history = self.state.sessions.setdefault(f"{user_id}:{req.session_id}", [])
        start_len = len(history)
        history.append({"role": "user", "content": req.text})
        screen = req.screen_context
        ui_state = ui.state_from_snapshot(req.snapshot, screen.screen_id if screen else None,
                                          screen.selected_asset if screen else None)
        ctx = ToolContext(self.state, self.cache, user_id, lang, screen, req.snapshot, ui_state)

        # ---- the model's tool loop ----
        text, calls, finish = None, 0, None
        try:
            while calls < MAX_MODEL_CALLS:
                msg, finish = self.llm.complete([system, *history], self.tools)
                calls += 1
                if finish == "content_filter":
                    text = REFUSAL_REPLY[lang]
                    history.append({"role": "assistant", "content": text})
                    break
                history.append(msg)
                if not msg.get("tool_calls"):
                    text = THINK_TAGS.sub("", msg["content"]).strip()
                    break
                for call in msg["tool_calls"]:
                    try:
                        args = parse_arguments(call["function"]["arguments"])
                        content = run_tool(ctx, call["function"]["name"], args)
                    except Exception as e:  # a broken tool call must not break the turn
                        content = json.dumps({"error": f"{type(e).__name__}: {e}"})
                    history.append({"role": "tool", "tool_call_id": call["id"], "content": content})
        except Exception:
            del history[start_len:]  # drop this turn so the session stays valid
            raise
        trim(history)

        if not text:
            text = FALLBACK_REPLY[lang]

        # ---- after the model: plain code ----
        ctx.ui_actions = ui.finalize(ctx.ui_actions)
        for action in ctx.ui_actions:  # last gate: only the closed set ever leaves the backend
            ui.validate(action)
        envelopes = list(ctx.results.values())
        return ChatReply(
            text=text,
            speak=req.input_mode == "voice",
            ui_actions=ctx.ui_actions,
            sources=[SourceRef(result_id=e["result_id"], tool=e["tool"], **e["source"])
                     for e in envelopes],
            debug={"provider": self.llm.provider, "model": self.llm.model, "model_calls": calls,
                   "finish_reason": finish, "lang": lang, "assets_mentioned": mentioned, "asks_for_advice": advice,
                   "screen_after": ctx.ui_state.screen, "asset_after": ctx.ui_state.asset,
                   "unbacked_numbers": unbacked_numbers(text, envelopes, req.text),
                   "latency_ms": round((time.perf_counter() - started) * 1000)},
        )
