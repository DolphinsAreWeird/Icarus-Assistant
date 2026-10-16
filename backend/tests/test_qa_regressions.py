"""Bugs found by QA agents, each with the case that found it."""
import math

import pytest

from app import display, knowledge
from app.assistant import guard, llm
from app.assistant.loop import MAX_HISTORY, Assistant, trim
from app.assistant.llm import tool_calls_in_text
from app.contracts import ChatRequest
from app.market.cache import PriceCache
from app.state import DemoState
from tests.test_brain import FakeLLM, SNAPSHOT, ask, calls, text, tool_results

import json


@pytest.fixture
def cache(tmp_path):
    from tests.test_brain import PRICES
    snap = tmp_path / "prices.json"
    snap.write_text(json.dumps(PRICES))
    return PriceCache(knowledge.assets(), offline=True, snapshot_file=snap)


@pytest.fixture
def state():
    return DemoState(clock=lambda: 1_792_060_000.0)


# ---------- the last check on what Icarus says ----------

@pytest.mark.parametrize("bad, rule", [
    ("You should buy gold now, it will almost certainly rise.", "advice"),
    ("Buy BTC, it is the best coin.", "advice"),
    ("I recommend putting 1,000 baht in gold.", "advice"),
    ("Now is a great time to buy bitcoin.", "advice"),
    ("Gold is a safe investment with guaranteed returns.", "advice"),
    ("ควรซื้อทองตอนนี้ รับรองว่าได้กำไรแน่นอน", "advice"),
    ("Done, I bought 1000 baht of gold for you.", "done"),
    ("Your purchase has been completed.", "done"),
    ("Your order was placed successfully.", "done"),
    ("ซื้อทองให้แล้วเรียบร้อย", "done"),
])
def test_guard_blocks_advice_and_claims_of_a_done_purchase(bad, rule):
    assert guard.violation(bad) == rule
    safe, found = guard.guard_text(bad, "th" if any("฀" <= c <= "๿" for c in bad) else "en")
    assert found == rule and safe != bad and "you should" not in safe.lower()


@pytest.mark.parametrize("fine", [
    "Nothing is bought until you tap Confirm purchase.",
    "Check the amount, fee and total. Nothing is bought until you tap Confirm purchase.",
    "Bitcoin is down about 24% over the past year.",
    "It's set up: 1,000 baht of gold plus a 10 baht fee. Tap Confirm purchase.",
    "Gold's price has gone up and down a lot. Past moves don't predict the future.",
    "I can't pick for you, but I can compare gold and Bitcoin on fees and past swings.",
    "Your card is frozen, so buying is blocked. Unfreeze it first.",
    "จะยังไม่ซื้อจนกว่าคุณจะแตะ Confirm purchase",
])
def test_guard_leaves_normal_replies_alone(fine):
    assert guard.violation(fine) is None


def test_legacy_engine_never_sends_advice_or_a_done_claim(cache, state):
    for i, bad in enumerate(("You should buy gold now, it will almost certainly rise.", "Done, I bought 1000 baht of gold for you.")):
        reply = ask(Assistant(FakeLLM([text(bad)]), state, cache), "hi", snapshot=SNAPSHOT, session=f"g{i}")
        assert reply.text != bad and reply.debug["guard"] in ("advice", "done")
    ok = ask(Assistant(FakeLLM([text("Gold is a metal.")]), state, cache), "hi", snapshot=SNAPSHOT, session="ok")
    assert ok.text == "Gold is a metal." and ok.debug["guard"] is None


def test_model_engine_reply_is_guarded_and_only_spoken_for_voice():
    from app.model_service import reply_envelope
    result = {"text": "You should buy gold now, it will almost certainly rise.", "language": "en", "sources": [], "status": "ok"}
    r = reply_envelope(result, "snap", "voice")
    assert r.text != result["text"] and r.speech == r.text and r.speak is True and r.debug["guard"] == "advice"
    assert reply_envelope({**result, "text": "Gold is a metal."}, "snap", "text").speak is False


def test_quick_intents_speak_only_for_voice_and_cancel_is_honest():
    from fastapi.testclient import TestClient
    from app.main import create_app
    with TestClient(create_app(engine="model", offline=True, poll=False, model_offline=True)) as c:
        assert c.post("/chat", json={"text": "Show me gold", "user_id": "u_new"}).json()["speak"] is False
        assert c.post("/chat", json={"text": "Show me gold", "user_id": "u_new", "input_mode": "voice"}).json()["speak"] is True
        nothing = c.post("/chat", json={"text": "cancel that", "user_id": "u_new"}).json()["text"]
        assert nothing == "There was no open preview to cancel."


# ---------- hostile model output ----------

@pytest.mark.parametrize("hostile", [
    '{"name":["x"],"arguments":{}}', '{"a":' * 3000, '{"name": 5}', '{"name": null, "arguments": 1}',
])
def test_hostile_tool_call_text_never_crashes(hostile):
    content, found = tool_calls_in_text(hostile, {"get_prices"})
    assert found == []


def test_json_quoted_in_a_normal_sentence_is_not_run():
    said = 'You could call {"name": "get_prices", "arguments": {"asset_ids": ["BTC"]}} but I will just tell you.'
    content, found = tool_calls_in_text(said, {"get_prices"})
    assert found == [] and content == said
    bare, found = tool_calls_in_text('{"name": "get_prices", "arguments": {"asset_ids": ["BTC"]}}', {"get_prices"})
    assert len(found) == 1 and bare == ""


def test_trim_never_drops_the_current_turn():
    history = []
    for i in range(3):
        history += [{"role": "user", "content": f"q{i}"}, {"role": "assistant", "content": "", "tool_calls": [{}]}] \
            + [{"role": "tool", "content": "x"}] * 4 + [{"role": "assistant", "content": "a"}]
    history += [{"role": "user", "content": "now"}] + [{"role": "assistant", "content": "x"}, {"role": "tool", "content": "y"}] * 10
    trim(history)
    assert history[0] == {"role": "user", "content": "now"} and len(history) == 21  # kept whole, even above MAX_HISTORY
    short = [{"role": "user", "content": "a"}, {"role": "assistant", "content": "b"}] * 5
    trim(short)
    assert len(short) <= MAX_HISTORY and short[0]["role"] == "user"


# ---------- honest labels and numbers ----------

def test_dollar_screens_are_not_called_baht(cache, state):
    usd = {"screen": "asset", "label": "Gold", "asset": {"id": "XAU", "name": "Gold", "price_usd": 2358.7},
           "period": "1M", "chart": {"start": 2281.1, "end": 2358.7, "high": 2371.2, "low": 2270.4, "change_pct": 3.4},
           "portfolio": {"value_usd": 4825.5}}
    fake = FakeLLM([calls(("explain_element", {"element_id": "asset.chart"}), ("get_portfolio", {})), text("ok")])
    ask(Assistant(fake, state, cache), "what is this", snapshot=usd)
    chart, portfolio = (r["data"] for r in tool_results(fake, 1))
    assert chart["numbers"]["currency"] == "USD" and "start" not in chart["numbers"]["say"]
    assert chart["numbers"]["say"]["change"] == "up about 3.4%"  # a percentage has no currency
    assert portfolio["currency"] == "USD"
    thb = {**usd, "currency": "THB", "asset": {"id": "XAU", "name": "Gold", "price_thb": 80000.0}}
    fake = FakeLLM([calls(("explain_element", {"element_id": "asset.chart"})), text("ok")])
    ask(Assistant(fake, state, cache), "what is this", snapshot=thb, session="thb")
    assert tool_results(fake, 1)[0]["data"]["numbers"]["currency"] == "THB"


def test_history_of_an_asset_without_data_says_so(cache, state):
    fake = FakeLLM([calls(("get_history", {"asset_id": "AAPL", "period": "1M"})), text("ok")])
    ask(Assistant(fake, state, cache), "apple history", snapshot=SNAPSHOT)
    data = tool_results(fake, 1)[0]["data"]
    assert data["available"] is False and "no price history" in data["note"]


@pytest.mark.parametrize("value, en", [
    (-5, "minus 5 baht"), (-1500, "minus about 1,500 baht"), (1050, "about 1,100 baht"), (999_999.5, "about 1 million baht"),
    (999.5, "1,000 baht"), (1e12, "about 1 trillion baht"), (2.5e9, "about 2.5 billion baht"), (0, "0 baht"),
    (float("nan"), "not available"), (float("inf"), "not available"), (None, "not available"),
])
def test_baht_edge_cases(value, en):
    assert display.baht(value) == en


def test_change_edge_cases():
    assert display.change(float("nan")) == "not available" and display.change(-23.97) == "down about 24%"
    assert not math.isnan(0)  # (nothing else may print "nan")
    assert "nan" not in display.baht(float("nan"), "th")
