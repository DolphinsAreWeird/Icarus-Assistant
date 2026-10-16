"""The routes before the model: prepared answers, the fast path, fact packs, the answer cache, the question log."""
import json

import pytest

from app.assistant.checks import SENTENCE_END, THAI, brief, plain_reply
from app.assistant.fastpath import parse
from app.assistant.loop import Assistant, NoModel
from app.assistant.memo import AnswerCache, QuestionLog, standalone
from app.assistant.normalize import normalize
from app.assistant.prepared import default as prepared_answers, sample_questions
from app.assistant.prompt import SAFETY_REPLY, SYSTEM_PROMPT
from app.contracts import ChatRequest
from app.facts import FactPacks
from app.trades import confirm_trade, prepare_trade
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


# ---------- vague questions: the model, with the screen ----------

VAGUE = ["help", "help me", "can you help me", "please help", "is it safe?", "is this safe?", "safe?", "what is it?",
         "what is this?", "what's this?", "explain this", "what am I looking at", "who?", "what?", "tell me more",
         "is this good?", "what's the risk?", "what's the balance?", "explain the balance", "I'm confused", "hmm",
         "ปลอดภัยไหม", "ช่วยหน่อย", "อันนี้คืออะไร", "งงมาก", "ทำยังไงดี"]


@pytest.mark.parametrize("question", VAGUE)
def test_vague_questions_get_no_prepared_answer_and_no_shortcut(question):
    # caught live: "help" and "is it safe?" got the same canned line whatever the screen showed
    p, norm = prepared_answers(), normalize(question)
    assert p.match_exact(norm) is None and p.match_near(question, norm) is None and parse(question) is None


def test_clear_safety_questions_keep_the_safety_answer():
    p = prepared_answers()
    for question in ["is my money safe", "Is my money safe here?", "is this app safe", "can I trust this app",
                     "is it safe here", "เงินของฉันปลอดภัยไหม", "แอปนี้ปลอดภัยไหม"]:
        norm = normalize(question)
        assert (p.match_exact(norm) or p.match_near(question, norm))["id"] == "is_my_money_safe", question
    assert p.entries["is_my_money_safe"]["say"] == SAFETY_REPLY  # what the model's guard says instead


def test_definitions_answer_the_word_not_the_one_on_screen():
    p = prepared_answers()
    near = lambda question: (p.match_near(question, normalize(question)) or {}).get("id")  # noqa: E731
    assert p.match_exact(normalize("What is volatility?"))["id"] == "what_is_volatility"
    assert near("volatility, what is it") == "what_is_volatility"     # the word, in another order
    assert near("what's the volatility") is None                      # the one on screen: the model answers
    assert near("what's the balance") is None and near("explain the balance") is None


def test_a_vague_question_goes_to_the_model_with_the_screen(cache, state):
    fake = FakeLLM([text("You're on gold's page: it's down about 3% over the past month. Want me to explain the chart?")])
    reply = ask(Assistant(fake, state, cache), "help", snapshot=GOLD_PAGE)
    assert reply.debug["route"] == "model" and len(fake.calls) == 1
    system = fake.calls[0]["messages"][0]["content"]
    assert system.startswith(SYSTEM_PROMPT + "\n\nContext for this turn:\n")  # the rules stay byte-identical
    assert "On screen: gold's page (the app's label: Gold · 1M chart)." in system
    assert "Things you can do here: explain the chart;" in system and '"This" or "here" means that page.' in system
    assert '"chart on screen":"down about 3% over the past month, from about' in system
    assert "Their message is short" in system and '"their money":{"cash":"5,000 baht","invested":"nothing yet"}' in system
    assert reply.text == "You're on gold's page: it's down about 3% over the past month. Want me to explain the chart?"
    assert {s.tool for s in reply.sources} == {"get_history"} and reply.debug["unbacked_numbers"] == []


def test_the_model_is_told_only_what_the_screen_shows(cache, state):
    fake = FakeLLM([text("This is your Home screen.")] * 3)
    bot = Assistant(fake, state, cache)
    context = lambda i: fake.calls[i]["messages"][0]["content"].split("Context for this turn:\n")[1]  # noqa: E731
    ask(bot, "what is this?", snapshot={**GOLD_PAGE, "screen": "home", "label": "Home"})  # the app still names gold
    assert "On screen: the Home screen" in context(0)
    assert "gold's page" not in context(0) and "chart on screen" not in context(0)
    ask(bot, "what does this mean?", snapshot={**GOLD_PAGE, "focus": "asset.change24h"}, session="s2")
    assert "They tapped this: How much the price moved in the last 24 hours, in percent." in context(1)
    bot.chat(ChatRequest(session_id="s3", user_id="u_new", text="what is this?"))  # no screen sent: nothing said
    assert "On screen" not in context(2)


def test_a_follow_up_gets_the_facts_of_the_last_exchange(cache, state):
    fake = FakeLLM([text("Over the past year it's up a little.")])
    bot = Assistant(fake, state, cache)
    ask(bot, "How is gold doing?")  # prepared: no model
    ask(bot, "tell me more")
    assert '"gold":{"price":"about 134,000 baht","today":"up about 0.5% today","1W":' in fake.calls[0]["messages"][0]["content"]


def test_a_security_claim_from_the_model_is_never_said(cache, state):
    fake = FakeLLM([text("Yes, your money is protected by bank-grade security and fully insured."),
                    text("Gold's price can fall as well as rise: it's down about 3% over the past month."),
                    text("แอปจริงมีมาตรการคุ้มครองเงินของคุณ")])
    bot = Assistant(fake, state, cache)
    reply = ask(bot, "is it safe?")
    assert reply.debug["route"] == "model" and reply.text == SAFETY_REPLY["en"] and reply.debug["guard"] == "security_claim"
    assert ask(bot, "is gold safe?", session="s2").text.startswith("Gold's price can fall")  # about the asset: kept
    assert ask(bot, "ปลอดภัยไหม", session="s3").text == SAFETY_REPLY["th"]


def test_advice_is_about_the_asset_on_screen(cache, state):
    assert parse("should I buy?", "XAU").args == {"asset_id": "XAU"}
    bot = Assistant(MustNotCall(), state, cache)
    assert "gold" in ask(bot, "What should I buy?", snapshot=GOLD_PAGE).text
    assert "gold" not in ask(bot, "What should I buy?", session="s2").text  # on Home there is no asset to name


def test_replies_are_brief_and_plain():
    # two sentences at most (the app speaks them): the filler goes, a second fact joins the first, the offer stays
    assert brief("I'm here to help! Your balance is 5,000 baht. You haven't bought anything yet. "
                 "Want me to show you how buying works?") == \
        "Your balance is 5,000 baht; you haven't bought anything yet. Want me to show you how buying works?"
    assert brief("I can't pick for you. Bitcoin is down about 24% over the past year. It's up today. Want its chart?") \
        == "I can't pick for you; Bitcoin is down about 24% over the past year. Want its chart?"
    long = ("You're on the Home screen, which shows your total balance across both of your wallets. "
            "There are buttons to receive, swap and send money, and a list of your recent transactions. "
            "Want me to explain your balance or show you how buying works?")
    assert brief(long) == ("You're on the Home screen, which shows your total balance across both of your wallets. "
                           "Want me to explain your balance or show you how buying works?")
    assert plain_reply("ไม่เป็นไรครับ ช่วยได้นะคะ มูลค่า 5,000 บาท", "th") == "ไม่เป็นไร ช่วยได้นะ มูลค่า 5,000 บาท"
    assert plain_reply("You can:\n- see prices\n- **buy**", "en") == "You can: see prices buy"
    thai = "บิตคอยน์ขึ้นลงแรง " * 9 + "ราคาประมาณ 2.8 ล้านบาท ลงประมาณ 24% ในปีที่ผ่านมา อยากดูกราฟไหม"
    cut = brief(thai, "th")
    assert len(cut) <= 180 and not cut.endswith(("2.8", "ประมาณ")) and cut.endswith("อยากดูกราฟไหม")


def test_conversational_follow_ups_and_other_screens_are_not_reused(cache, state):
    assert not standalone(normalize("what do you mean")) and not standalone(normalize("and then?"))
    fake = FakeLLM([text("That's how much gold moved since yesterday."), text("That's gold over the past month.")])
    bot = Assistant(fake, state, cache)
    ask(bot, "what does this mean?", snapshot={**GOLD_PAGE, "focus": "asset.change24h"})
    reply = ask(bot, "what does this mean?", snapshot={**GOLD_PAGE, "focus": "asset.chart"}, session="s2")
    assert reply.debug["route"] == "model" and reply.text == "That's gold over the past month."  # another element


def test_model_answers_are_kept_per_user_until_their_money_changes(cache, state):
    fake = FakeLLM([text("You have 5,000 baht."), text("You have 4,000 baht in cash.")])
    bot = Assistant(fake, state, cache)
    ask(bot, "what's going on with my money")
    assert ask(bot, "what's going on with my money", session="s2").debug["route"] == "cache"
    confirm_trade(state, "u_new", prepare_trade(state, cache, "u_new", "gold", "buy", 1000)["preview_id"])
    assert ask(bot, "what's going on with my money", session="s3").text == "You have 4,000 baht in cash."


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
                    calls(("get_asset_info", {"asset_id": "BTC"})), text("<think>done</think>"),
                    calls(("get_history", {"asset_id": "BTC", "period": "1Y"})), text(""),
                    calls(("get_prices", {"asset_ids": ["XAU"]})), text("")])
    bot = Assistant(fake, state, cache)
    assert ask(bot, "Show me Ethereum").text == "Opened the Ethereum page."
    assert ask(bot, "What is Bitcoin?", session="s2").text.startswith("Bitcoin is the first and biggest cryptocurrency.")
    risky = ask(bot, "is bitcoin risky?", session="s3").text  # caught live: silent after a data tool
    assert risky.startswith("Bitcoin is ") and risky.endswith(" over the past year.")
    assert ask(bot, "anything new with gold?", session="s4").text == "Gold is about 134,000 baht, up about 0.5% today."


def test_long_model_answers_are_cut_to_two_sentences_without_em_dashes(cache, state):
    fake = FakeLLM([text("One thing. Two things. Three things. Four."), text("It isn't in the app — which one?")])
    bot = Assistant(fake, state, cache)
    assert ask(bot, "Tell me a story about the S&P 500").text == "One thing. Two things."
    assert ask(bot, "Tell me about the Nasdaq", session="s2").text == "It isn't in the app, which one?"


# ---------- the answer cache, the log, warming up ----------

@pytest.mark.parametrize("claim, figure, value, lang", [
    ("Bitcoin costs 999999 baht today.", "999999", 999999.0, "en"),
    ("ราคา999999บาท", "999999", 999999.0, "th"),
    ("ราคาหนึ่งล้านบาท", "หนึ่งล้าน", 1000000.0, "th"),
    ("Bitcoin costs one million baht today.", "one million", 1000000.0, "en"),
])
def test_invented_price_is_never_cached_or_retained(cache, state, claim, figure, value, lang):
    fake = FakeLLM([text(claim)] * 2)
    bot = Assistant(fake, state, cache)
    for _ in range(2):
        reply = bot.chat(ChatRequest(session_id="s1", user_id="u_new",
                                    text="Is bitcoin risky to hold long term?", lang=lang,
                                    input_mode="voice", snapshot=HOME))
        assert reply.status == "unavailable"
        assert reply.debug["route"] == "model"
        assert figure not in reply.text and reply.speak and reply.speech is None
        assert reply.debug["unbacked_numbers"] == [value]
    assert len(fake.calls) == 2 and not bot.answers._items
    assert figure not in json.dumps(state.sessions, ensure_ascii=False)
    assert figure not in json.dumps(fake.calls[1]["messages"], ensure_ascii=False)


@pytest.mark.parametrize("claim, lang", [
    ("Gold costs one hundred and thirty-four thousand baht.", "en"),
    ("ทองราคา134000บาท", "th"),
    ("ทองราคาหนึ่งแสนสามหมื่นสี่พันบาท", "th"),
])
def test_grounded_word_and_unspaced_thai_prices_remain_cacheable(cache, state, claim, lang):
    fake = FakeLLM([calls(("get_prices", {"asset_ids": ["XAU"]})), text(claim)])
    bot = Assistant(fake, state, cache)
    request = ChatRequest(session_id="s1", user_id="u_new", text="Is gold risky to hold long term?",
                          input_mode="voice", lang=lang, snapshot=HOME)
    first = bot.chat(request)
    again = bot.chat(request.model_copy(update={"session_id": "s2"}))  # a cache hit needs a first turn
    assert first.status == again.status == "ok"
    assert first.text == again.text == claim and first.speak and again.speak
    assert first.sources and again.sources == first.sources
    assert again.debug["route"] == "cache" and len(fake.calls) == 2


def test_prepared_wording_cannot_retain_invented_figures(cache, state):
    odd = {**HOME, "portfolio": {"value_usd": 4825.5, "positions": 3}}
    fake = FakeLLM([text("Your portfolio is worth 999999 baht.")])
    reply = ask(Assistant(fake, state, cache), "explain my portfolio", snapshot=odd)
    assert reply.debug["route"] == "prepared" and reply.debug["model_calls"] == 1
    assert reply.status == "unavailable" and "999999" not in reply.text
    assert "999999" not in json.dumps(state.sessions)


def test_cached_figures_are_rechecked_against_retained_evidence(cache, state):
    fake = FakeLLM([text("Gold is about 134,000 baht.")])
    bot = Assistant(fake, state, cache)
    question = "Explain gold pricing in detail"
    first = ask(bot, question)
    assert first.status == "ok" and first.sources
    cached = ask(bot, question, session="s2")
    assert cached.debug["route"] == "cache" and cached.text == first.text
    assert cached.sources == first.sources
    # Simulate a stale/unsafe entry created before the guard, with source labels
    # but no evidence supporting its invented number.
    key = next(iter(bot.answers._items))
    hit = bot.answers.get(key)
    hit["text"] = "Bitcoin costs 999999 baht today."
    hit.pop("grounding")
    bot.answers.put(key, hit)
    bot.llm = FakeLLM([text("Gold is about 134,000 baht.")])
    checked = ask(bot, question, session="s3")
    assert checked.debug["route"] == "model" and checked.status == "ok"
    assert "999999" not in json.dumps(state.sessions)

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
    ask(bot, "how is my money split up", session="s4")  # a first turn, so it is cached (for u_new only)
    assert ask(bot, "how is my money split up", user="u_small").text == "You have 1,195 baht."  # not u_new's answer
    ask(bot, "and what about it today")
    assert ask(bot, "and what about it today", session="s3").debug["route"] == "model"  # leans on the conversation


def _situation_bot(cache, state, script):
    fake = FakeLLM(script)
    return fake, Assistant(fake, state, cache)


def test_history_dependent_answer_is_not_shared_with_another_user(cache, state):
    fake, bot = _situation_bot(cache, state, [
        text("Noted."), text("Your goal of a secret yacht is far off."), text("I can't see your accounts.")])
    ask(bot, "My private goal is a secret yacht", user="u_new", session="a")
    first = ask(bot, "How does my financial situation look?", user="u_new", session="a")
    other = ask(bot, "How does my financial situation look?", user="u_small", session="b")
    assert "yacht" in first.text and other.debug["route"] == "model" and "yacht" not in other.text
    assert len(fake.calls) == 3
    assert "yacht" not in json.dumps(fake.calls[2]["messages"])


def test_history_dependent_answer_is_not_reused_in_the_users_other_session(cache, state):
    fake, bot = _situation_bot(cache, state, [
        text("Noted."), text("Your goal of a secret yacht is far off."), text("Tell me more about your goals.")])
    ask(bot, "My private goal is a secret yacht", session="a")
    ask(bot, "How does my financial situation look?", session="a")
    again = ask(bot, "How does my financial situation look?", session="b")
    assert again.debug["route"] == "model" and "yacht" not in again.text


def test_same_question_with_different_history_in_one_session_is_asked_again(cache, state):
    fake, bot = _situation_bot(cache, state, [text("One."), text("Two."), text("Three.")])
    ask(bot, "Is bitcoin risky to hold long term?")
    second = ask(bot, "Is bitcoin risky to hold long term?")  # history now exists
    third = ask(bot, "Is bitcoin risky to hold long term?")
    assert [second.debug["route"], third.debug["route"]] == ["model", "model"] and len(fake.calls) == 3


def test_generic_first_turn_question_is_never_shared_across_users(cache, state):
    # every model prompt now carries the user's own money ("their money"), so no answer is shared across users
    hist = calls(("get_history", {"asset_id": "BTC", "period": "1Y"}))
    fake, bot = _situation_bot(cache, state, [hist, text("Bitcoin is down about 24% over the past year."),
                                              hist, text("Bitcoin is down about 24% over the past year.")])
    state.users["u_small"]["journey"]["stage"] = state.users["u_new"]["journey"]["stage"]  # same prompt context
    ask(bot, "Is bitcoin risky to hold long term?", user="u_new", session="a")
    other = ask(bot, "Is bitcoin risky to hold long term?", user="u_small", session="b")
    assert other.debug["route"] == "model" and len(fake.calls) == 4
    again = ask(bot, "Is bitcoin risky to hold long term?", user="u_new", session="c")
    assert again.debug["route"] == "cache" and len(fake.calls) == 4  # the same user, unchanged money: reused


def test_personal_answer_is_reused_only_for_the_same_account_and_screen_data(cache, state):
    portfolio = calls(("get_portfolio", {}))
    fake, bot = _situation_bot(cache, state, [portfolio, text("Mostly cash."), portfolio, text("Now some gold."),
                                              portfolio, text("Your screen shows 2 assets.")])
    first = ask(bot, "how is my money split up", session="a")
    assert ask(bot, "how is my money split up", session="b").debug["route"] == "cache"  # same account, same screen
    state.users["u_new"]["cash_thb"] -= 1  # the account changed (a trade): the old reply is stale
    changed = ask(bot, "how is my money split up", session="c")
    assert changed.debug["route"] == "model" and changed.text != first.text
    # another visitor's app (mapped to the same demo user) sends its own screen numbers
    other_screen = HOME | {"portfolio": {"total_thb": 2, "holdings": [{"asset_id": "XAU"}, {"asset_id": "BTC"}]}}
    seen = ask(bot, "how is my money split up", session="d", snapshot=other_screen)
    assert seen.debug["route"] == "model" and len(fake.calls) == 6


def test_screen_context_is_part_of_the_cache_key(cache, state):
    from app.contracts import ScreenContext
    fake, bot = _situation_bot(cache, state, [text("It is the total."), text("It is the change."), text("again")])

    def focused(session, el):
        return bot.chat(ChatRequest(session_id=session, user_id="u_new", text="Explain what this number means",
                                    snapshot=HOME, screen_context=ScreenContext(screen_id="home", focused_element=el)))
    a, b, a2 = focused("a", "balance"), focused("b", "change"), focused("c", "balance")
    assert [a.debug["route"], b.debug["route"], a2.debug["route"]] == ["model", "model", "cache"]
    assert b.text == "It is the change." and a2.text == a.text


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
