"""The brain without a real model: a scripted fake client plays the LLM's part."""
import json

import pytest
from fastapi.testclient import TestClient

from app import knowledge
from app.assistant.checks import detect_language, mentioned_assets, numbers_in_text, unbacked_numbers
from app.assistant.loop import Assistant
from app.contracts import ChatRequest, ScreenContext
from app.main import create_app
from app.market.cache import PriceCache
from app.state import DemoState
from app.tools import tool_specs
from app.trades import TradeError, confirm_trade

PRICES = {"fx": {"rate": 33.5, "as_of": "2026-10-14", "source": "test"},
          "prices": {"gold": {"asset_id": "gold", "price_usd": 4000.0, "price_thb": 134_000.0,
                              "change_24h_pct": 0.5, "as_of": "2026-10-15T09:00:00+00:00",
                              "source": "binance", "fetched_at": 0},
                     "btc": {"asset_id": "btc", "price_usd": 80000.0, "price_thb": 2_680_000.0,
                             "change_24h_pct": -2.0, "as_of": "2026-10-15T09:00:00+00:00",
                             "source": "binance", "fetched_at": 0}}}


def text(t):
    return {"role": "assistant", "content": t}, "stop"


def calls(*tool_calls):
    return {"role": "assistant", "content": "", "tool_calls": [
        {"id": f"call_{i}", "type": "function",
         "function": {"name": name, "arguments": json.dumps(args)}}
        for i, (name, args) in enumerate(tool_calls)]}, "tool_calls"


class FakeLLM:
    """Plays the model: returns scripted (message, finish_reason) pairs, records requests."""
    provider, model = "fake", "scripted"

    def __init__(self, script):
        self.script, self.calls = list(script), []

    def complete(self, messages, tools):
        self.calls.append({"messages": list(messages), "tools": tools})  # as sent
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def tool_results(fake, call_index):
    """The tool messages sent to the model on that call."""
    return [json.loads(m["content"]) for m in fake.calls[call_index]["messages"] if m["role"] == "tool"]


@pytest.fixture
def cache(tmp_path):
    snap = tmp_path / "prices.json"
    snap.write_text(json.dumps(PRICES))
    return PriceCache(knowledge.assets(), offline=True, snapshot_file=snap)


@pytest.fixture
def state():
    return DemoState(clock=lambda: 1_792_060_000.0)  # 2026-10-15


def ask(bot, msg, user="u_new", screen=None, session="s1"):
    return bot.chat(ChatRequest(session_id=session, user_id=user, text=msg, screen_context=screen))


# ---------- say-to-act ----------

def test_buy_gold_makes_a_preview_card_and_changes_nothing(cache, state):
    fake = FakeLLM([
        calls(("prepare_trade", {"asset_id": "gold", "side": "buy", "amount_thb": 1000})),
        text("Here's your preview. You pay 1,000 baht and the fee is 5 baht. Tap Confirm."),
    ])
    reply = ask(Assistant(fake, state, cache), "Put 1,000 baht in gold")

    card = reply.ui_actions[0]
    assert card.type == "card" and card.card_type == "trade_preview"
    assert card.data["fee_thb"] == 5.0
    assert card.data["qty"] == pytest.approx(995 / 134_000)
    assert card.data["grams"] == pytest.approx(995 / 134_000 * 31.1035, abs=1e-4)
    assert [s.tool for s in reply.sources] == ["prepare_trade"]
    assert reply.debug["assets_mentioned"] == ["gold"]
    assert reply.debug["unbacked_numbers"] == []
    assert state.users["u_new"]["cash_thb"] == 5000.0  # nothing bought yet


def test_confirm_is_the_only_way_to_buy_and_is_idempotent(cache, state):
    fake = FakeLLM([
        calls(("prepare_trade", {"asset_id": "gold", "side": "buy", "amount_thb": 1000})),
        text("Tap Confirm."),
    ])
    preview_id = ask(Assistant(fake, state, cache), "buy gold 1000").ui_actions[0].data["preview_id"]

    first = confirm_trade(state, "u_new", preview_id)
    second = confirm_trade(state, "u_new", preview_id)  # double tap
    assert first == second
    assert state.users["u_new"]["cash_thb"] == 4000.0
    assert state.users["u_new"]["journey"]["stage"] == "first_purchase"
    assert len(state.users["u_new"]["transactions"]) == 2  # deposit + one buy

    with pytest.raises(TradeError) as e:
        confirm_trade(state, "u_small", preview_id)  # someone else's preview
    assert e.value.code == "preview_not_found"


def test_expired_preview_is_rejected(cache, state):
    fake = FakeLLM([
        calls(("prepare_trade", {"asset_id": "gold", "side": "buy", "amount_thb": 1000})),
        text("Tap Confirm."),
    ])
    preview_id = ask(Assistant(fake, state, cache), "buy gold").ui_actions[0].data["preview_id"]
    state.clock = lambda: 1_792_060_000.0 + 121
    with pytest.raises(TradeError) as e:
        confirm_trade(state, "u_new", preview_id)
    assert e.value.code == "preview_expired"


def test_not_enough_cash_comes_back_as_data_not_a_crash(cache, state):
    fake = FakeLLM([
        calls(("prepare_trade", {"asset_id": "btc", "side": "buy", "amount_thb": 9000})),
        text("You have 5,000 baht, so that's too much."),
    ])
    reply = ask(Assistant(fake, state, cache), "buy 9000 of bitcoin")
    assert reply.ui_actions == []
    result = tool_results(fake, 1)[0]
    assert result["data"] == {"ok": False, "reason": "not_enough_cash", "cash_thb": 5000.0}
    assert reply.debug["unbacked_numbers"] == []


# ---------- explain anything ----------

def test_explain_chart_uses_the_screen_the_user_is_on(cache, state):
    fake = FakeLLM([
        calls(("explain_element", {"element_id": "asset.chart"}),
              ("highlight_element", {"element_id": "asset.chart", "message": "This line"})),
        text("This line is gold's price over the last month."),
    ])
    screen = ScreenContext(screen_id="asset_detail", selected_asset="gold", chart_period="1m",
                           focused_element="asset.chart")
    reply = ask(Assistant(fake, state, cache), "What does this line mean?", screen=screen)

    results = tool_results(fake, 1)
    assert len(results) == 2
    explained = results[0]["data"]
    assert explained["selected_asset"] == "gold"
    assert explained["live"]["period"] == "1m"
    assert explained["live"]["summary"]["points"] == 30
    assert reply.ui_actions[0].type == "highlight"


# ---------- safety and plumbing ----------

def test_request_shape(cache, state):
    fake = FakeLLM([text("Hi!")])
    ask(Assistant(fake, state, cache), "สวัสดี")
    call = fake.calls[0]
    roles = [m["role"] for m in call["messages"]]
    assert roles == ["system", "user"]  # rules + this turn's context come first
    assert "Reply language: Thai" in call["messages"][0]["content"]
    assert {t["function"]["name"] for t in call["tools"]} >= {"prepare_trade", "explain_element"}


def test_model_refusal_gets_a_safe_reply(cache, state):
    fake = FakeLLM([({"role": "assistant", "content": ""}, "content_filter")])
    reply = ask(Assistant(fake, state, cache), "something odd")
    assert reply.text.startswith("Sorry, I can't help")


def test_failed_model_call_leaves_session_clean(cache, state):
    fake = FakeLLM([RuntimeError("network down"), text("Hello again.")])
    bot = Assistant(fake, state, cache)
    with pytest.raises(RuntimeError):
        ask(bot, "hello")
    assert state.sessions["u_new:s1"] == []
    ask(bot, "hello")
    assert [m["role"] for m in state.sessions["u_new:s1"]] == ["user", "assistant"]


def test_broken_tool_returns_an_error_result_and_the_turn_finishes(cache, state):
    fake = FakeLLM([
        calls(("highlight_element", {"element_id": "nope", "message": "x"})),
        text("Let me show you another way."),
    ])
    reply = ask(Assistant(fake, state, cache), "show me")
    assert "unknown element" in tool_results(fake, 1)[0]["error"]
    assert reply.text == "Let me show you another way."


def test_made_up_number_is_flagged(cache, state):
    fake = FakeLLM([
        calls(("get_prices", {"asset_ids": ["gold"]})),
        text("Gold is about 134,000 baht, up 0.5% today. Last week it was 99,999."),
    ])
    reply = ask(Assistant(fake, state, cache), "gold price?")
    assert reply.debug["unbacked_numbers"] == [99999.0]


def test_tool_schemas_use_enums():
    specs = {t["function"]["name"]: t["function"]["parameters"] for t in tool_specs()}
    for params in specs.values():
        assert params["additionalProperties"] is False
    assert specs["prepare_trade"]["properties"]["asset_id"]["enum"] == list(knowledge.assets())


def test_bad_arguments_from_a_weak_model_become_tool_errors(cache, state):
    fake = FakeLLM([
        ({"role": "assistant", "content": "", "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "get_prices", "arguments": "{oops"}},
            {"id": "c2", "type": "function", "function": {"name": "get_history",
                                                          "arguments": '{"asset_id": "gold"}'}}]},
         "tool_calls"),
        text("Sorry, try again."),
    ])
    reply = ask(Assistant(fake, state, cache), "gold?")
    errors = [r["error"] for r in tool_results(fake, 1)]
    assert errors[0].startswith("JSONDecodeError") and errors[1].startswith("TypeError")
    assert reply.text == "Sorry, try again."


def test_think_tags_are_removed(cache, state):
    fake = FakeLLM([text("<think>user wants gold</think>Gold is tokenized.")])
    assert ask(Assistant(fake, state, cache), "gold?").text == "Gold is tokenized."


def test_long_sessions_are_trimmed_at_a_user_message(cache, state):
    fake = FakeLLM([text("ok")] * 12)
    bot = Assistant(fake, state, cache)
    for i in range(12):
        ask(bot, f"message {i}")
    history = state.sessions["u_new:s1"]
    assert len(history) <= 16 and history[0]["role"] == "user"


# ---------- checks ----------

def test_checks():
    assert detect_language("ซื้อทองคำ 1,000 บาท") == "th"
    assert mentioned_assets("ซื้อทองคำ 1,000 บาท", knowledge.assets()) == ["gold"]
    assert mentioned_assets("something about methods", knowledge.assets()) == []
    assert numbers_in_text("pay 1,000.50 baht, about 2.7 million") == [(1000.5, 2), (2_700_000.0, -6)]
    assert unbacked_numbers("about 2.7 million baht", [{"p": 2_729_983.59}], "") == []
    assert unbacked_numbers("down about 3%", [{"c": -3.02}], "") == []
    assert unbacked_numbers("in 2 steps", [], "") == []
    # caught live: mistral said "up 5 percent" when the tool said 0.2
    assert unbacked_numbers("gold went up 5 percent", [{"c": 0.2}], "") == [5.0]
    assert unbacked_numbers("up 5%", [{"c": 0.2}], "") == [5.0]


# ---------- HTTP API ----------

def test_api_end_to_end(cache):
    fake = FakeLLM([
        calls(("prepare_trade", {"asset_id": "gold", "side": "buy", "amount_thb": 1000})),
        text("Tap Confirm to buy."),
    ])
    api = TestClient(create_app(llm=fake, offline=True, poll=False))

    assert api.get("/health").json()["assistant"] == "fake/scripted"
    assert api.get("/prices?ids=gold").json()["gold"]["freshness"] == "offline"
    assert len(api.get("/history/gold?period=1w").json()["rows"]) == 168

    reply = api.post("/chat", json={"session_id": "s", "user_id": "u_new",
                                    "text": "Put 1,000 baht in gold"}).json()
    preview_id = reply["ui_actions"][0]["data"]["preview_id"]
    r = api.post(f"/trades/{preview_id}/confirm", json={"user_id": "u_new"})
    assert r.status_code == 200 and r.json()["cash_thb"] == 4000.0
    assert api.get("/portfolio/u_new").json()["holdings"][0]["asset_id"] == "gold"

    api.post("/demo/reset")
    assert api.get("/portfolio/u_new").json()["cash_thb"] == 5000.0

    err = api.post("/chat", json={"session_id": "s", "user_id": "nobody", "text": "hi"})
    assert err.status_code == 404
    assert err.json()["detail"]["code"] == "unknown_user"
    assert api.post("/trades/pv_nope/confirm", json={"user_id": "u_new"}).status_code == 404
