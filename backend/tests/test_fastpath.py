"""The routes before the model: prepared answers, the fast path, fact packs, the answer cache, the question log."""
import json

import pytest

from app.assistant.checks import SENTENCE_END, THAI
from app.assistant.fastpath import parse
from app.assistant.loop import Assistant, NoModel
from app.assistant.memo import AnswerCache, QuestionLog
from app.assistant.normalize import normalize
from app.assistant.prepared import default as prepared_answers, sample_questions
from app.contracts import ChatRequest
from app.facts import FactPacks
from tests.test_brain import SNAPSHOT, FakeLLM, cache, calls, state, text, types  # noqa: F401  (fixtures)

HOME = {"screen": "home", "label": "Home screen"}
GOLD_PAGE = {"screen": "asset", "label": "Gold · 1M chart", "asset": {"id": "XAU", "name": "Gold"}, "period": "1M",
             "currency": "THB", "data_source": "backend_demo"}


class MustNotCall:
    provider, model = "none", "none"

    def complete(self, messages, tools):
        raise AssertionError("the model was called")


class Named(FakeLLM):
    last_model, last_provider = "Qwen 3.8-27B", "orion"


def ask(bot, msg, snapshot=HOME, lang=None, user="u_new", session="s1"):
    return bot.chat(ChatRequest(session_id=session, user_id=user, text=msg, lang=lang, snapshot=snapshot))


# ---------- reading the request ----------

@pytest.mark.parametrize("text, here, kind, args", [
    ("How is gold doing?", None, "price", {"asset_id": "XAU"}),
    ("Buy 1000 baht of gold", None, "trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000.0}),
    ("Hey Icarus, could you put ฿1,000 in PAXG please?", None, "trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000.0}),
    ("sell 500 baht of bitcoin", None, "trade", {"asset_id": "BTC", "side": "sell", "amount_thb": 500.0}),
    ("buy 500 baht", "ETH", "trade", {"asset_id": "ETH", "side": "buy", "amount_thb": 500.0}),  # on Ethereum's page
    ("What is Bitcoin?", None, "info", {"asset_id": "BTC"}),
    ("Show me Ethereum", None, "show", {"asset_id": "ETH"}),
    ("Should I buy Bitcoin now?", None, "advice", {"asset_id": "BTC"}),
    ("is gold a good investment", None, "advice", {"asset_id": "XAU"}),
    ("Compare gold and bitcoin over a year", None, "compare", {"asset_ids": ["XAU", "BTC"], "period": "1Y"}),
    ("eth vs btc", None, "compare", {"asset_ids": ["ETH", "BTC"], "period": "1Y"}),
    ("how did ethereum do over the past 3 months", None, "history", {"asset_id": "ETH", "period": "3M"}),
    ("how do I buy bitcoin?", None, "steps", {"topic": "buy", "asset_id": "BTC"}),
    ("walk me through buying gold step by step", None, "guide", {"asset_id": "XAU"}),
    ("freeze my card", None, "freeze", {"frozen": True}),
    ("unlock my card", None, "freeze", {"frozen": False}),
    ("hide my balance", None, "hide", {"hidden": True}),
    ("go back", None, "back", {}),
    ("never mind", None, "cancel", {}),
    ("what's my balance?", None, "portfolio", {"style": "balance"}),
    ("what are the fees", None, "fees", {}),
    ("what is the fee for 2,000 baht", None, "fees", {"amount_thb": 2000.0}),
    ("switch to one year", None, "period", {"period": "1Y"}),
    ("open my portfolio", None, "screen", {"screen": "portfolio"}),
    ("ทองวันนี้เป็นยังไง", None, "price", {"asset_id": "XAU"}),
    ("ซื้อทองคำ 1,000 บาท", None, "trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000.0}),
    ("ลงทุนทองพันบาท", None, "trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000.0}),
    ("ขายบิทคอยน์ 500 บาท", None, "trade", {"asset_id": "BTC", "side": "sell", "amount_thb": 500.0}),
    ("ขอดูราคาบิทคอยน์หน่อยค่ะ", None, "show_price", {"asset_id": "BTC"}),
    ("บิตคอยน์คืออะไร", None, "info", {"asset_id": "BTC"}),
    ("ควรซื้อบิทคอยน์ไหม", None, "advice", {"asset_id": "BTC"}),
    ("เปรียบเทียบทองกับบิทคอยน์", None, "compare", {"asset_ids": ["XAU", "BTC"], "period": "1Y"}),
    ("บิทคอยน์ย้อนหลัง 1 ปีเป็นยังไง", None, "history", {"asset_id": "BTC", "period": "1Y"}),
    ("ช่วยล็อคบัตรด้วยนะครับ", None, "freeze", {"frozen": True}),
    ("ดูย้อนหลัง 1 ปี", None, "period", {"period": "1Y"}),
    ("ซื้อยังไง", None, "steps", {"topic": "buy", "asset_id": None}),
    ("ค่าธรรมเนียมเท่าไหร่", None, "fees", {}),
])
def test_common_requests_are_read_in_english_and_thai(text, here, kind, args):
    intent = parse(text, here)
    assert (intent.kind, intent.args) == (kind, args)


@pytest.mark.parametrize("text", [
    "How is the S&P 500 doing?", "How is Tesla doing?", "What is the price of Apple?",
    "Don't put 1000 baht in gold", "If I buy 1000 baht of gold", "What if I buy 1000 baht of gold",
    "Put 1000 baht in gold and buy bitcoin", "Show me gold. Then buy 1000 baht.", "Put 1.0001 baht in gold",
    "buy gold 1000", "buy 1000 baht", "Should I put 1000 baht in gold?", "gold?",
    "bitcoin vs bitcoin", "freeze unfreeze...", "Confirm the purchase", "how is my money split",
    "Is gold more volatile than bitcoin?", "can you recommend a coin", "show me gold and bitcoin",
    "ซื้อทองคำ 1000 บาท แล้วซื้อบิทคอยน์", "ไม่ต้องซื้อทอง", "ถ้าทองลง ควรขายไหม",
])
def test_anything_unclear_goes_to_the_model(text):
    assert parse(text) is None


@pytest.mark.parametrize("text, kind", [
    ("Put -1000 baht in gold", "bad_amount"), ("Buy -500 baht of gold", "bad_amount"),
    ("Buy 1000 baht of Tesla", "stocks"), ("Buy 10 Tesla shares", "stocks"), ("Invest in Apple", "stocks"),
    ("I have 50,000 baht, what should I do with it?", "advice"), ("Where should I put my money?", "advice"),
])
def test_minus_amounts_stocks_and_money_questions_never_reach_the_model(text, kind):
    # A minus amount is asked again (never read as a buy), stocks are look-only in the demo, and
    # "what should I do with my money" is advice: all answered in code, so the model can't get them wrong.
    assert parse(text).kind == kind


def test_normalize():
    assert normalize("Could you put ฿1,000 in PAXG please?") == "put 1000 baht in gold"
    assert normalize("What's BTC's price?") == "what is bitcoin price"
    assert normalize("ช่วยล็อคบัตรด้วยนะครับ") == "ล็อกบัตร"
    assert normalize("ซื้อทองคำ 1,000 บาท") == "ซื้อ gold 1000 baht"


# ---------- answering without the model ----------

@pytest.mark.parametrize("question, lang, route", [
    ("How is gold doing?", "en", "prepared"), ("Buy 1000 baht of gold", "en", "prepared"),
    ("What is Bitcoin?", "en", "prepared"), ("Show me Ethereum", "en", "prepared"),
    ("Should I buy Bitcoin now?", "en", "prepared"), ("ทองวันนี้เป็นยังไง", "th", "prepared"),
    ("Compare gold and bitcoin over a year", "en", "prepared"), ("what is volatility", "en", "prepared"),
    ("What is blockchain?", "en", "prepared"), ("how did bitcoin do over the past month", "en", "fastpath"),
    ("sell 500 baht of bitcoin", "en", "fastpath"), ("ขอดูราคาบิทคอยน์หน่อยค่ะ", "th", "fastpath"),
    ("what's the fee on 2,500 baht", "en", "fastpath"), ("ค่าธรรมเนียมเท่าไห", "th", "prepared"),  # a typo, nearly
])
def test_common_requests_need_no_model_call(cache, state, question, lang, route):
    reply = ask(Assistant(MustNotCall(), state, cache), question, lang=lang)
    assert reply.debug["route"] == route and reply.debug["model_calls"] == 0 and reply.debug["model"] is None
    assert reply.text and len(SENTENCE_END.split(reply.text)) <= 2 and reply.debug["unbacked_numbers"] == []
    assert bool(THAI.search(reply.text)) == (lang == "th")
    assert state.sessions["u_new:s1"][-2:] == [{"role": "user", "content": question},
                                               {"role": "assistant", "content": reply.text}]  # the model sees it later


def test_a_buy_gives_the_same_card_as_the_tool_loop(cache, state, monkeypatch):
    fast = ask(Assistant(MustNotCall(), state, cache), "Put 1,000 baht in gold")
    monkeypatch.setenv("FASTPATH", "0")
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})), text("ok")])
    loop = ask(Assistant(fake, state, cache), "Put 1,000 baht in gold", session="s2")
    assert types(fast.ui_actions) == types(loop.ui_actions) == ["open_asset", "card"]
    card = lambda reply: {k: v for k, v in reply.ui_actions[1]["data"].items() if k != "preview_id"}  # noqa: E731
    assert card(fast) == card(loop) and card(fast)["fee_thb"] == 5.0
    assert [s.tool for s in fast.sources] == [s.tool for s in loop.sources] == ["prepare_trade"]
    assert fast.text == "Here's your preview: 1,000 baht of gold, about 0.23 grams, with a 5 baht fee included. " \
                        "Tap Confirm on the card to buy."  # 995 baht at 134,000 a token of 31.1 g
    assert state.users["u_new"]["cash_thb"] == 5000.0  # nothing bought: the user taps Confirm


def test_trade_problems_are_said_plainly(cache, state):
    bot = Assistant(MustNotCall(), state, cache)
    assert ask(bot, "Buy 9000 baht of gold").text == "You have 5,000 baht in cash, which isn't enough for 9,000 baht."
    assert ask(bot, "Buy 50 baht of gold").text == "The smallest buy is 100 baht, so I can't set up 50 baht."
    with pytest.raises(AssertionError, match="the model was called"):
        ask(bot, "buy 500 baht")  # which asset? the model asks
    reply = ask(bot, "buy 500 baht", snapshot=GOLD_PAGE)  # on gold's page: the page says which asset
    assert reply.ui_actions[0]["card_type"] == "trade_preview" and reply.ui_actions[0]["data"]["asset_id"] == "gold"


def test_the_chart_on_screen_is_explained_from_the_series_the_app_draws(cache, state):
    reply = ask(Assistant(MustNotCall(), state, cache), "What does this chart mean?", snapshot=GOLD_PAGE)
    assert reply.ui_actions == [{"type": "highlight", "element_id": "asset.chart"}]
    assert reply.text.startswith("This line shows gold's price over the past month, down about 3%")
    assert {s.tool for s in reply.sources} == {"explain_element", "get_history"} and reply.debug["unbacked_numbers"] == []


def test_what_a_shortcut_cannot_do_goes_to_the_model(cache, state):
    fake = FakeLLM([text("Open an asset's page to see its chart.")])
    reply = ask(Assistant(fake, state, cache), "What does this chart mean?")  # on Home: no chart to explain
    assert reply.debug["route"] == "model" and reply.ui_actions == [] and len(fake.calls) == 1


def test_fastpath_0_sends_everything_to_the_model(cache, state, monkeypatch):
    monkeypatch.setenv("FASTPATH", "0")
    fake = FakeLLM([text("Gold is up.")])
    assert ask(Assistant(fake, state, cache), "How is gold doing?").debug["route"] == "model"
    assert len(fake.calls) == 1


def test_without_a_model_the_shortcuts_still_answer(cache, state):
    bot = Assistant(None, state, cache)
    assert ask(bot, "Show me gold").debug["route"] == "prepared"
    with pytest.raises(NoModel):
        ask(bot, "How is the S&P 500 doing?")


def test_a_portfolio_we_cannot_phrase_gets_one_model_call_and_no_tools(cache, state):
    odd = {**HOME, "portfolio": {"value_usd": 4825.5, "positions": 3}}  # the app's own demo data, in a new shape
    fake = FakeLLM([text("Your portfolio holds three positions.")])
    reply = ask(Assistant(fake, state, cache), "explain my portfolio", snapshot=odd)
    assert reply.debug["route"] == "prepared" and reply.debug["model_calls"] == 1 and reply.debug["model"] == "scripted"
    assert fake.calls[0]["tools"] == [] and '"positions": 3' in fake.calls[0]["messages"][0]["content"]
    assert reply.text == "Your portfolio holds three positions."
    down = FakeLLM([RuntimeError("down")])
    assert ask(Assistant(down, state, cache), "explain my portfolio", snapshot=odd).text == \
        "Your portfolio is on the Portfolio screen."  # the model failed: still an answer
    allocation = ask(Assistant(MustNotCall(), state, cache), "explain my portfolio", snapshot=SNAPSHOT)
    assert allocation.text == "80% of your portfolio is in Bitcoin."  # a shape we know: no call


# ---------- prepared answers and fact packs ----------

def test_prepared_answers_match_exactly_nearly_and_never_on_a_near_miss():
    p = prepared_answers()
    near = lambda text: (p.match_near(text, normalize(text)) or {}).get("id")  # noqa: E731
    assert p.match_exact(normalize("Put ฿1,000 in gold"))["id"] == "buy_1000_gold"
    assert near("minimum buy, what is it") == "minimum_buy"             # other order, small words
    assert near("how much money do I have now") == "my_balance"
    assert near("ค่าธรรมเนียมเท่าไห") == "fees"                         # Thai, nearly the same string
    for miss in ["what is bitcoin mining", "should i buy bitcoin or gold", "how much money do i have in gold",
                 "show me gold and bitcoin", "ค่าธรรมเนียมซื้อทองเท่าไหร่", "don't freeze my card"]:
        assert near(miss) is None, miss


def test_every_prepared_answer_is_complete():
    p = prepared_answers()
    kinds = {"show", "show_price", "trade", "period", "freeze", "hide", "back", "cancel", "steps", "guide", "compare",
             "explain_chart", "portfolio", "price", "advice"}
    for entry in p.entries.values():
        assert entry["ask"]["en"] and entry["ask"]["th"], entry["id"]
        assert entry.get("do") or entry.get("say") or entry.get("glossary"), entry["id"]
        assert not entry.get("do") or entry["do"]["kind"] in kinds, entry["id"]
        for line in (entry.get("say") or {}).values():
            assert "—" not in line and len(SENTENCE_END.split(line)) == 1, entry["id"]
    claimed = {}
    for e in p.entries.values():
        for ways in e["ask"].values():
            for way in ways:
                claimed.setdefault(normalize(way), set()).add(e["id"])
    assert {q: ids for q, ids in claimed.items() if len(ids) > 1} == {}  # no two answers claim one question
    assert all(p.match_exact(q)["id"] in ids for q, ids in claimed.items())
    assert len(p.entries) >= 40 and len(sample_questions()) >= 80


def test_templates_say_the_current_facts(cache, state):
    facts = FactPacks(cache)
    p = prepared_answers()
    ctx = Assistant(MustNotCall(), state, cache, facts=facts)._context(
        ChatRequest(text="x", user_id="u_new"), "u_new", "en")
    assert p.render("{XAU.Name} is {XAU.price}, {XAU.today}.", ctx, facts, "en") == "Gold is about 134,000 baht, up about 0.5% today."
    cache.prices["gold"] |= {"price_thb": 150_000.0, "change_24h_pct": -1.2}
    facts.refresh()
    assert p.render("{XAU.Name} is {XAU.price}, {XAU.today}.", ctx, facts, "en") == "Gold is about 150,000 baht, down about 1.2% today."
    assert p.render("{ETH.price}", ctx, facts, "en") is None  # no ETH price in this cache: the answer can't be given
    assert [e["tool"] for e in ctx.results.values()] == ["get_prices", "get_prices"]  # cited, once per answer


def test_a_template_with_no_value_falls_through_to_the_model(cache, state):
    fake = FakeLLM([text("Gold and Bitcoin moved a little today.")])
    reply = ask(Assistant(fake, state, cache), "How is the market today?")  # no ETH price in this cache
    assert reply.debug["route"] == "model" and len(fake.calls) == 1


def test_fact_pack_version_changes_only_when_what_we_say_changes(cache):
    facts = FactPacks(cache)
    version = facts.version
    cache.prices["gold"]["price_thb"] += 10  # 134,010: still "about 134,000 baht"
    assert facts.refresh() and facts.version == version
    cache.prices["gold"]["price_thb"] = 150_000.0
    assert facts.refresh() and facts.version != version and facts.say("XAU", "en")["price"] == "about 150,000 baht"
    assert facts.say("XAU", "th")["price"] == "ประมาณ 150,000 บาท"


def test_the_model_gets_the_facts_in_its_context_and_cites_them(cache, state):
    fake = Named([text("Gold is about 134,000 baht, and the S&P 500 isn't in the app.")])
    reply = ask(Assistant(fake, state, cache), "Is gold doing better than the S&P 500?")
    system = fake.calls[0]["messages"][0]["content"]
    assert "Facts for this turn" in system and "about 134,000 baht" in system
    assert reply.debug["route"] == "model" and reply.debug["model_calls"] == 1
    assert reply.debug["model"] == "Qwen 3.8-27B" and reply.debug["provider"] == "orion"  # who answered, not the chain
    assert [s.tool for s in reply.sources] == ["get_prices"] and reply.debug["unbacked_numbers"] == []


def test_when_the_model_says_nothing_its_tools_speak(cache, state, monkeypatch):
    monkeypatch.setenv("FASTPATH", "0")
    fake = FakeLLM([calls(("show_asset", {"asset_id": "ETH"})), text(""),
                    calls(("get_asset_info", {"asset_id": "BTC"})), text("<think>done</think>")])
    bot = Assistant(fake, state, cache)
    assert ask(bot, "Show me Ethereum").text == "Opened the Ethereum page."
    assert ask(bot, "What is Bitcoin?", session="s2").text.startswith("Bitcoin is the first and biggest cryptocurrency.")


def test_long_model_answers_are_cut_to_two_sentences_without_em_dashes(cache, state):
    fake = FakeLLM([text("One thing. Two things. Three things. Four."), text("It isn't in the app — which one?")])
    bot = Assistant(fake, state, cache)
    assert ask(bot, "Tell me a story about the S&P 500").text == "One thing. Two things."
    assert ask(bot, "Tell me about the Nasdaq", session="s2").text == "It isn't in the app, which one?"


# ---------- the answer cache, the log, warming up ----------

def test_model_answers_are_reused_for_the_same_question_screen_and_facts(cache, state):
    fake = FakeLLM([calls(("get_history", {"asset_id": "BTC", "period": "1Y"})),
                    text("Bitcoin is down about 24% over the past year.")])
    bot = Assistant(fake, state, cache)
    first = ask(bot, "Is bitcoin risky to hold long term?")
    again = ask(bot, "is Bitcoin risky to hold long-term", session="s2")
    assert first.debug["route"] == "model" and again.debug["route"] == "cache"
    assert again.text == first.text and again.debug["model_calls"] == 0 and len(fake.calls) == 2
    bot.llm = FakeLLM([text("Bitcoin swings more than gold.")])
    on_gold = ask(bot, "Is bitcoin risky to hold long term?", snapshot=GOLD_PAGE, session="s3")
    assert on_gold.debug["route"] == "model"  # another screen, another answer


def test_trades_personal_answers_and_follow_ups_are_not_reused_across(cache, state):
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})), text("Preview ready."),
                    calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})), text("Preview ready."),
                    calls(("get_portfolio", {})), text("You have 5,000 baht."),
                    calls(("get_portfolio", {})), text("You have 1,195 baht."),
                    text("Still the same."), text("Still the same.")])
    bot = Assistant(fake, state, cache)
    ask(bot, "set up a gold buy of 1000 baht for me")
    assert ask(bot, "set up a gold buy of 1000 baht for me", session="s2").debug["route"] == "model"  # a new card each time
    ask(bot, "how is my money split up")
    assert ask(bot, "how is my money split up", user="u_small").text == "You have 1,195 baht."  # not u_new's answer
    ask(bot, "and what about it today")
    assert ask(bot, "and what about it today", session="s3").debug["route"] == "model"  # leans on the conversation


def test_cached_answers_expire():
    now = [0.0]
    answers = AnswerCache(ttl_s=300, clock=lambda: now[0])
    answers.put(("q",), {"text": "a"})
    now[0] = 299
    assert answers.get(("q",)) == {"text": "a"}
    now[0] = 601
    assert answers.get(("q",)) is None


def test_every_question_is_logged_with_its_route(cache, state, tmp_path):
    log = QuestionLog(tmp_path / "questions.jsonl")
    bot = Assistant(FakeLLM([text("I don't have data on the S&P 500.")]), state, cache, log=log)
    ask(bot, "Show me gold")
    ask(bot, "How is the S&P 500 doing?")
    lines = [json.loads(line) for line in (tmp_path / "questions.jsonl").read_text().splitlines()]
    assert [(r["text"], r["route"], r["model_calls"]) for r in lines] == [
        ("Show me gold", "prepared", 0), ("How is the S&P 500 doing?", "model", 1)]
    assert lines[0]["answer"] == "show_gold" and lines[0]["screen"] == "home"


def test_prewarm_answers_the_prepared_questions_without_the_model(cache, state):
    bot = Assistant(MustNotCall(), state, cache)
    answered = bot.prewarm()
    assert answered >= 0.8 * len(sample_questions())  # all but the few this test cache has no data for
    assert state.sessions == {} and state.previews == {}  # the real account is untouched
