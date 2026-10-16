"""The brain without a real model: a scripted fake plays the LLM's part."""
import json
import re
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app import knowledge, ui
from app.assistant.checks import detect_language, mentioned_assets, numbers_in_text, unbacked_numbers
from app.assistant.llm import tool_calls_in_text
from app.assistant.loop import Assistant
from app.contracts import ChatRequest, ScreenContext
from app.main import create_app
from app.market.cache import PriceCache
from app.state import DemoState
from app.tools import tool_specs
from app.trades import TradeError, confirm_trade, prepare_trade

REPO = Path(__file__).resolve().parents[2]
PROTOTYPE = REPO / "frontend" / "prototype" / "Icarus Prototype.dc.html"
BRIDGE = REPO / "frontend" / "src" / "backend-bridge.ts"

PRICES = {"fx": {"rate": 33.5, "as_of": "2026-10-14", "source": "test"},
          "prices": {"gold": {"asset_id": "gold", "price_usd": 4000.0, "price_thb": 134_000.0,
                              "change_24h_pct": 0.5, "as_of": "2026-10-15T09:00:00+00:00",
                              "source": "binance", "fetched_at": 0},
                     "btc": {"asset_id": "btc", "price_usd": 80000.0, "price_thb": 2_680_000.0,
                             "change_24h_pct": -2.0, "as_of": "2026-10-15T09:00:00+00:00",
                             "source": "binance", "fetched_at": 0}}}

# What the prototype's getContext() sends, on the Gold page with the 1M chart.
SNAPSHOT = {"screen": "asset", "label": "Gold · 1M chart", "language": "en",
            "asset": {"id": "XAU", "name": "Gold", "price_usd": 2358.7, "change_24h_pct": 0.48},
            "period": "1M", "chart": {"start": 2281.1, "end": 2358.7, "high": 2371.2, "low": 2270.4,
                                      "change_pct": 3.4},
            "buy": None, "portfolio": {"value_usd": 4825.5, "allocation": [{"id": "BTC", "pct": 80.0}]},
            "data_source": "demo"}


# ---------- fake model ----------

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
    return [json.loads(m["content"]) for m in fake.calls[call_index]["messages"] if m["role"] == "tool"]


@pytest.fixture(autouse=True)
def model_loop_only(monkeypatch):
    """These tests script the model's part, so every question must reach the model's tool loop.
    Without this, the prepared answers or the fast path would answer 15 of them before the model
    (put 1,000 baht in gold, cancel that, show me gold, how do I buy?, hello, ...).
    The shortcuts have their own tests in test_fastpath.py."""
    monkeypatch.setenv("FASTPATH", "0")


@pytest.fixture
def cache(tmp_path):
    snap = tmp_path / "prices.json"
    snap.write_text(json.dumps(PRICES))
    return PriceCache(knowledge.assets(), offline=True, snapshot_file=snap)


@pytest.fixture
def state():
    return DemoState(clock=lambda: 1_792_060_000.0)  # 2026-10-15


def ask(bot, msg, snapshot=None, screen=None, user="u_new", session="s1"):
    return bot.chat(ChatRequest(session_id=session, user_id=user, text=msg,
                                screen_context=screen, snapshot=snapshot))


def types(actions):
    return [a["type"] for a in actions]


# ---------- the closed action set ----------

def test_closed_set_has_no_confirm():
    assert not any("confirm" in t or "execute" in t for t in ui.ACTIONS)
    for bad in ({"type": "confirm"}, {"type": "confirm_purchase"}, {"type": "execute_trade"}):
        with pytest.raises(ui.UIError):
            ui.validate(bad)


@pytest.mark.parametrize("action", [
    {"type": "open_asset", "asset": "DOGE"},
    {"type": "set_period", "period": "5Y"},
    {"type": "type_amount", "value": 50},
    {"type": "highlight", "target": "nope.button"},
    {"type": "navigate", "to": {"tab": "settings"}},
    {"type": "review", "extra": 1},
    {"type": "toggle_freeze", "value": "yes"},
])
def test_validate_rejects_anything_off_the_list(action):
    with pytest.raises(ui.UIError):
        ui.validate(action)


@pytest.mark.skipif(not PROTOTYPE.exists(), reason="prototype not in this checkout")
def test_every_action_we_send_is_one_the_prototype_runs():
    runs = set(re.findall(r"case '(\w+)':", PROTOTYPE.read_text(encoding="utf-8")))
    runs.add("start_guide")  # handled before doAction, in splitActs
    assert set(ui.ACTIONS) - {"card"} <= runs  # card goes to the team's trade card, not doAction


@pytest.mark.skipif(not BRIDGE.exists(), reason="frontend bridge not in this checkout")
def test_the_bridge_passes_on_everything_we_send():
    bridge = BRIDGE.read_text(encoding="utf-8")
    assert "a.type === 'highlight' && typeof a.element_id === 'string'" in bridge
    for card_type in ui.CARD_TYPES:
        assert f"a.card_type === '{card_type}'" in bridge, card_type
    passed = set(re.search(r"SCREEN_ACTIONS = new Set\(\[([^\]]*)\]", bridge).group(1).replace("'", "").replace(" ", "").split(","))
    assert set(ui.ACTIONS) - {"card", "highlight"} <= passed


@pytest.mark.skipif(not PROTOTYPE.exists(), reason="prototype not in this checkout")
def test_every_element_we_know_exists_in_the_prototype():
    html = PROTOTYPE.read_text(encoding="utf-8")
    ids = set(re.findall(r'data-ui-id="([^"{]+)"', html))
    for element_id in knowledge.ui_elements():
        if element_id.startswith("invest.asset."):
            assert "invest.asset.{{ a.id }}" in html
        else:
            assert element_id in ids, element_id


# ---------- the planner: same intent, different starting screens ----------

@pytest.mark.parametrize("start, expected", [
    ("asset", ["set_period"]),
    ("portfolio", ["set_period"]),
    ("card", ["navigate", "set_period"]),       # portfolio chart lives on Invest
    ("buy", ["open_asset", "set_period"]),      # asset chart lives on the asset page
])
def test_change_period_goes_where_the_chart_is(start, expected):
    assert types(ui.change_chart_period(ui.UIState(start, "XAU"), "1Y")) == expected


@pytest.mark.parametrize("start, element, expected", [
    ("asset", "home.balance", ["navigate", "highlight"]),
    ("home", "asset.chart", ["open_asset", "highlight"]),
    ("buy", "buy.fee_line", ["highlight"]),
    ("asset", "asset.change24h", ["highlight"]),
    ("buy_review", "buy.confirm_button", ["highlight"]),
])
def test_point_at_goes_to_the_elements_screen(start, element, expected):
    assert types(ui.point_at(ui.UIState(start, "XAU"), element)) == expected


def test_point_at_buy_screen_parts_needs_the_buy_screen_open():
    for element in ("buy.confirm_button", "buy.fee_line"):
        with pytest.raises(ui.UIError):
            ui.point_at(ui.UIState("asset", "XAU"), element)


def test_other_intents():
    assert ui.show_asset(ui.UIState("home"), "BTC", "1Y") == [
        {"type": "open_asset", "asset": "BTC"}, {"type": "set_period", "period": "1Y"}]
    assert ui.show_asset(ui.UIState("asset", "BTC"), "BTC") == []          # already there
    assert ui.go_to_screen(ui.UIState("asset"), "portfolio") == [
        {"type": "navigate", "to": {"tab": "invest", "view": "portfolio"}}]
    assert types(ui.set_balances_hidden(ui.UIState("asset"), True)) == ["navigate", "hide_balance"]
    assert ui.set_card_frozen(ui.UIState("home"), True) == [{"type": "toggle_freeze", "value": True}]
    assert ui.filter_assets(ui.UIState("home"), "Crypto") == [{"type": "set_filter", "filter": "Crypto"}]
    assert ui.guide_me(ui.UIState("home"), "XAU") == [{"type": "start_guide", "asset": "XAU"}]


def test_state_from_the_apps_snapshot():
    assert ui.state_from_snapshot(SNAPSHOT) == ui.UIState("asset", "XAU")
    review = {**SNAPSHOT, "screen": "buy", "label": "Buy Gold · review"}
    assert ui.state_from_snapshot(review).screen == "buy_review"
    assert ui.state_from_snapshot(None, "asset_detail", "gold") == ui.UIState("asset", "XAU")
    assert ui.to_app_asset("xau") == "XAU" and ui.to_app_asset("btc") == "BTC"


# ---------- through the brain ----------

def test_put_1000_baht_in_gold_opens_gold_and_shows_our_card(cache, state):
    fake = FakeLLM([
        calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})),
        text("Here's your preview. You pay 1,000 baht and the fee is 5 baht. Tap Confirm on the card."),
    ])
    reply = ask(Assistant(fake, state, cache), "Put 1,000 baht in gold", snapshot={**SNAPSHOT, "screen": "home"})
    assert types(reply.ui_actions) == ["open_asset", "card"]
    card = reply.ui_actions[1]
    assert card["card_type"] == "trade_preview"
    assert card["data"]["fee_thb"] == 5.0 and card["data"]["you_pay_thb"] == 1000
    assert card["data"]["qty"] == pytest.approx(995 / 134_000)
    assert reply.debug["unbacked_numbers"] == []
    assert state.users["u_new"]["cash_thb"] == 5000.0  # nothing bought: the user taps Confirm


def test_on_golds_page_the_card_comes_without_moving(cache, state):
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})), text("ok")])
    reply = ask(Assistant(fake, state, cache), "buy 1000 baht", snapshot=SNAPSHOT)
    assert types(reply.ui_actions) == ["card"]


def test_buy_problems_come_back_as_data_with_no_card(cache, state):
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "BTC", "side": "buy", "amount_thb": 9000}),
                          ("prepare_trade", {"asset_id": "BTC", "side": "buy", "amount_thb": 50}),
                          ("prepare_trade", {"asset_id": "AAPL", "side": "buy", "amount_thb": 500})),
                    text("You have 5,000 baht, and the minimum is 100.")])
    reply = ask(Assistant(fake, state, cache), "buy", snapshot=SNAPSHOT)
    results = tool_results(fake, 1)
    assert results[0]["data"] == {"ok": False, "reason": "not_enough_cash", "cash_thb": 5000.0}
    assert results[1]["data"]["reason"] == "below_minimum"
    assert results[2]["reason"] == "no_data"
    assert reply.ui_actions == [] and reply.debug["unbacked_numbers"] == []


def test_cancel_stops_a_late_tap_on_the_card(cache, state):
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})), text("ok"),
                    calls(("cancel_trade", {})), text("Cancelled.")])
    bot = Assistant(fake, state, cache)
    preview_id = ask(bot, "buy gold 1000", snapshot=SNAPSHOT).ui_actions[0]["data"]["preview_id"]
    ask(bot, "cancel that", snapshot=SNAPSHOT)
    assert tool_results(fake, 3)[-1]["done"] == "Cancelled the preview. Nothing was bought."
    with pytest.raises(TradeError) as e:
        confirm_trade(state, "u_new", preview_id)
    assert e.value.code == "preview_cancelled"
    assert state.users["u_new"]["cash_thb"] == 5000.0


def test_two_intents_in_one_turn_chain_from_where_the_first_ended(cache, state):
    fake = FakeLLM([
        calls(("show_asset", {"asset_id": "BTC", "period": "1Y"}),
              ("prepare_trade", {"asset_id": "BTC", "side": "buy", "amount_thb": 500})),
        text("Done."),
    ])
    reply = ask(Assistant(fake, state, cache), "show bitcoin over a year then set up 500 baht",
                snapshot={**SNAPSHOT, "screen": "home"})
    assert types(reply.ui_actions) == ["open_asset", "set_period", "card"]  # no second open_asset


def test_stand_in_brain_still_works(cache, state):
    """KP's rule-based stand-in (scripts/stand_in_brain.py) calls prepare_trade with our data ids."""
    from scripts.stand_in_brain import StandInModel
    reply = ask(Assistant(StandInModel(), state, cache), "put 1,000 baht in gold")
    assert types(reply.ui_actions) == ["open_asset", "card"]
    assert reply.text.startswith("Here's your preview. You pay 1,000 baht")


def test_a_guide_runs_alone(cache, state):
    fake = FakeLLM([calls(("guide_me", {"asset_id": "BTC"}), ("show_asset", {"asset_id": "BTC"}),
                          ("highlight_element", {"element_id": "asset.buy_button"})), text("Follow along.")])
    reply = ask(Assistant(fake, state, cache), "walk me through buying bitcoin", snapshot=SNAPSHOT)
    assert reply.ui_actions == [{"type": "start_guide", "asset": "BTC"}]
    assert [r["reason"] for r in tool_results(fake, 1)[1:]] == ["guide_running", "guide_running"]


def test_tool_calls_written_as_plain_json_still_run():
    # caught live: the local model replied with just the JSON of the call, once with a stray "<"
    content, found = tool_calls_in_text('<{"name": "explain_element", "arguments": {"element_id": "asset.chart"}}',
                                    {"explain_element"})
    assert content == "" and found[0]["function"]["name"] == "explain_element"
    # and as tags: <show_asset asset_id="XAU"/> and Qwen's <function=..><parameter=..>
    _, tag = tool_calls_in_text('<show_asset asset_id="XAU"/>', {"show_asset"})
    assert json.loads(tag[0]["function"]["arguments"]) == {"asset_id": "XAU"}
    _, qwen = tool_calls_in_text("<function=prepare_buy><parameter=asset_id>XAU</parameter>"
                                 "<parameter=amount_thb>1000</parameter></function>", {"prepare_buy"})
    assert json.loads(qwen[0]["function"]["arguments"]) == {"asset_id": "XAU", "amount_thb": 1000}
    assert tool_calls_in_text('{"name": "rm_rf", "arguments": {}}', {"cancel_buy"})[1] == []  # unknown: ignored


def test_failed_intent_tells_the_model_and_adds_nothing(cache, state):
    fake = FakeLLM([calls(("highlight_element", {"element_id": "buy.confirm_button"})), text("It's not open.")])
    reply = ask(Assistant(fake, state, cache), "where is confirm", snapshot={**SNAPSHOT, "screen": "home"})
    assert reply.ui_actions == []
    assert tool_results(fake, 1)[0]["reason"] == "not_on_buy_screen"


def test_too_many_actions_are_refused(cache, state):
    many = [("set_card_frozen", {"frozen": i % 2 == 0}) for i in range(9)]
    fake = FakeLLM([calls(*many), text("ok")])
    reply = ask(Assistant(fake, state, cache), "freeze unfreeze...", snapshot=SNAPSHOT)
    assert len(reply.ui_actions) == ui.MAX_ACTIONS_PER_TURN
    assert tool_results(fake, 1)[-1]["reason"] == "too_many_actions"


def test_explain_uses_the_numbers_on_screen_and_highlights(cache, state):
    fake = FakeLLM([calls(("explain_element", {"element_id": "asset.chart"})),
                    text("Gold went up 3.4% this month.")])
    snap = {**SNAPSHOT, "focus": "asset.chart"}
    reply = ask(Assistant(fake, state, cache), "What does this line mean?", snapshot=snap)
    result = tool_results(fake, 1)[0]
    assert result["data"]["numbers"]["change_pct"] == 3.4
    assert result["data"]["numbers"]["currency"] == "THB"  # the app sends everything in baht now
    assert result["data"]["numbers"]["say"]["change"] == "up about 3.4%"
    assert result["source"]["provider"] == "app screen (demo data)"
    assert reply.ui_actions == [{"type": "highlight", "element_id": "asset.chart"}]
    assert reply.debug["unbacked_numbers"] == []


def test_explain_without_the_app_uses_our_history(cache, state):
    fake = FakeLLM([calls(("explain_element", {"element_id": "asset.chart"})), text("ok")])
    screen = ScreenContext(screen_id="asset", selected_asset="gold", chart_period="1M")
    ask(Assistant(fake, state, cache), "explain", screen=screen)
    assert tool_results(fake, 1)[0]["data"]["numbers"]["summary"]["points"] == 30


def test_portfolio_answers_about_what_the_app_shows(cache, state):
    fake = FakeLLM([calls(("get_portfolio", {})), text("80% is in Bitcoin.")])
    ask(Assistant(fake, state, cache), "how is my money split", snapshot=SNAPSHOT)
    assert tool_results(fake, 1)[0]["data"] == SNAPSHOT["portfolio"]


def test_prices_use_app_asset_ids(cache, state):
    fake = FakeLLM([calls(("get_prices", {"asset_ids": ["XAU", "AAPL"]})), text("ok")])
    ask(Assistant(fake, state, cache), "prices?")
    data = tool_results(fake, 1)[0]["data"]
    assert data["XAU"]["price_thb"] == 134_000.0
    assert data["AAPL"] == {"available": False, "note": "no live data for this asset"}


def test_voice_server_request_shape(cache, state):
    req = ChatRequest(**{"text": "show me gold", "language": "auto", "snapshot": SNAPSHOT,
                         "userId": "demo-user"})
    assert req.user_id == "demo-user" and req.lang is None
    assert req.screen_context.screen_id == "asset" and req.screen_context.chart_period == "1M"
    fake = FakeLLM([text("You're on gold already.")])
    assert Assistant(fake, state, cache).chat(req).text == "You're on gold already."  # demo-user -> u_new


def test_unknown_real_user_is_refused(cache, state):
    from app.assistant.loop import UnknownUser
    with pytest.raises(UnknownUser):
        ask(Assistant(FakeLLM([]), state, cache), "hi", user="nobody")


# ---------- plumbing and safety ----------

def test_request_shape(cache, state):
    fake = FakeLLM([text("Hi!")])
    ask(Assistant(fake, state, cache), "สวัสดี", snapshot=SNAPSHOT)
    call = fake.calls[0]
    assert [m["role"] for m in call["messages"]] == ["system", "user"]
    assert "Reply language: Thai" in call["messages"][0]["content"]
    assert "The app shows: Gold · 1M chart." in call["messages"][0]["content"]
    names = {t["function"]["name"] for t in call["tools"]}
    assert {"prepare_trade", "cancel_trade", "show_asset", "go_to_screen", "explain_element"} <= names
    assert not names & {"prepare_buy", "cancel_buy"}


def test_tool_schemas_use_the_apps_ids():
    specs = {t["function"]["name"]: t["function"]["parameters"] for t in tool_specs()}
    app = knowledge.app_ui()
    assert specs["prepare_trade"]["properties"]["asset_id"]["enum"] == list(app["assets"])
    assert specs["prepare_trade"]["required"] == ["asset_id", "side", "amount_thb"]
    assert specs["change_chart_period"]["properties"]["period"]["enum"] == app["periods"]
    assert specs["highlight_element"]["properties"]["element_id"]["enum"] == list(app["elements"])


def test_model_refusal_gets_a_safe_reply(cache, state):
    fake = FakeLLM([({"role": "assistant", "content": ""}, "content_filter")])
    assert ask(Assistant(fake, state, cache), "odd").text.startswith("Sorry, I can't help")


def test_failed_model_call_leaves_session_clean(cache, state):
    fake = FakeLLM([RuntimeError("network down"), text("Hello again.")])
    bot = Assistant(fake, state, cache)
    with pytest.raises(RuntimeError):
        ask(bot, "hello")
    assert state.sessions["u_new:s1"] == []
    ask(bot, "hello")
    assert [m["role"] for m in state.sessions["u_new:s1"]] == ["user", "assistant"]


def test_bad_arguments_from_a_weak_model_become_tool_errors(cache, state):
    fake = FakeLLM([
        ({"role": "assistant", "content": "", "tool_calls": [
            {"id": "c1", "type": "function", "function": {"name": "get_prices", "arguments": "{oops"}},
            {"id": "c2", "type": "function", "function": {"name": "show_asset",
                                                          "arguments": '{"asset_id": "DOGE"}'}}]},
         "tool_calls"),
        text("Sorry, try again."),
    ])
    reply = ask(Assistant(fake, state, cache), "gold?")
    results = tool_results(fake, 1)
    assert results[0]["error"].startswith("JSONDecodeError")
    assert results[1]["ok"] is False and results[1]["reason"] == "bad_value"
    assert reply.ui_actions == [] and reply.text == "Sorry, try again."


def test_made_up_number_is_flagged(cache, state):
    fake = FakeLLM([calls(("get_prices", {"asset_ids": ["XAU"]})),
                    text("Gold is about 134,000 baht, up 0.5% today. Last week it was 99,999.")])
    assert ask(Assistant(fake, state, cache), "gold price?").debug["unbacked_numbers"] == [99999.0]


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


def test_checks():
    assert detect_language("ซื้อทองคำ 1,000 บาท") == "th"
    assert mentioned_assets("ซื้อทองคำ 1,000 บาท", knowledge.assets()) == ["gold"]
    assert mentioned_assets("something about methods", knowledge.assets()) == []
    assert numbers_in_text("pay 1,000.50 baht, about 2.7 million") == [(1000.5, 2), (2_700_000.0, -6)]
    assert unbacked_numbers("about 2.7 million baht", [{"p": 2_729_983.59}], "") == []
    assert unbacked_numbers("down about 3%", [{"c": -3.02}], "") == []
    assert unbacked_numbers("in 2 steps", [], "") == []
    assert unbacked_numbers("over the last 24 hours", [], "") == []
    # caught live: mistral said "up 5 percent" when the tool said 0.2
    assert unbacked_numbers("gold went up 5 percent", [{"c": 0.2}], "") == [5.0]


# ---------- our own trade preview and confirm (backend API, not used by the app flow) ----------

def test_trade_preview_and_idempotent_confirm(cache, state):
    preview = prepare_trade(state, cache, "u_new", "gold", "buy", 1000)
    assert preview["fee_thb"] == 5.0
    first = confirm_trade(state, "u_new", preview["preview_id"])
    assert confirm_trade(state, "u_new", preview["preview_id"]) == first
    assert state.users["u_new"]["cash_thb"] == 4000.0
    with pytest.raises(TradeError):
        confirm_trade(state, "u_small", preview["preview_id"])


# ---------- HTTP API ----------

def test_api_with_the_bridges_request(cache):
    """The exact request frontend/src/backend-bridge.ts sends (toChatRequest): no snapshot, lowercase ids."""
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})),
                    text("Here's your preview. Tap Confirm on the card.")])
    api = TestClient(create_app(llm=fake, offline=True, poll=False))
    assert api.get("/health").json()["assistant"] == "fake/scripted"
    assert len(api.get("/history/gold?period=1W").json()["rows"]) == 168

    reply = api.post("/chat", json={
        "session_id": "app-x", "user_id": "u_new", "text": "Put 1,000 baht in gold", "lang": "en",
        "input_mode": "text",
        "screen_context": {"screen_id": "asset_detail", "selected_asset": "gold", "chart_period": "1m",
                           "visible_elements": [], "focused_element": None, "entered_amount": None}}).json()
    assert types(reply["ui_actions"]) == ["card"]  # already on gold's page
    preview_id = reply["ui_actions"][0]["data"]["preview_id"]
    r = api.post(f"/trades/{preview_id}/confirm", json={"user_id": "u_new"})
    assert r.status_code == 200 and r.json()["cash_thb"] == 4000.0

    err = api.post("/chat", json={"text": "hi", "user_id": "nobody"})
    assert err.status_code == 404 and err.json()["detail"]["code"] == "unknown_user"


def test_lowercase_period_from_the_bridge_works(cache, state):
    fake = FakeLLM([calls(("explain_element", {"element_id": "asset.chart"})), text("ok")])
    req = ChatRequest(text="what is this", user_id="u_new",
                      screen_context={"screen_id": "asset_detail", "selected_asset": "gold", "chart_period": "1m"})
    assert req.screen_context.chart_period == "1M"
    Assistant(fake, state, cache).chat(req)
    assert tool_results(fake, 1)[0]["data"]["numbers"]["summary"]["points"] == 30


# ---------- numbers the way people say them, charts and steps ----------

def test_numbers_are_said_rounded_in_baht():
    from app import display
    assert display.baht(3_607_006) == "about 3.6 million baht"
    assert display.baht(2_000_000) == "about 2 million baht"
    assert display.baht(139_618.62) == "about 140,000 baht"
    assert display.baht(4_825.5) == "about 4,800 baht"
    assert display.baht(5) == "5 baht"
    assert display.baht(2_729_983, "th") == "ประมาณ 2.7 ล้านบาท"
    assert display.change(-23.97) == "down about 24%" and display.change(0.42) == "up about 0.4%"
    assert display.exact_baht(1000) == "1,000 baht" and display.exact_baht(2.5) == "2.50 baht"
    # and the numbers check accepts them against the exact tool numbers
    assert unbacked_numbers("about 3.6 million baht, down about 24%", [{"a": 3_607_006, "c": -23.97}], "") == []


def test_history_comes_with_say_text(cache, state):
    fake = FakeLLM([calls(("get_history", {"asset_id": "BTC", "period": "1Y"})), text("ok")])
    ask(Assistant(fake, state, cache), "bitcoin past year?")
    say = tool_results(fake, 1)[0]["data"]["say"]
    assert say["change"].startswith(("up about", "down about")) and say["change"].endswith("over the past year")
    assert "million baht" in say["start"]


def test_chart_card_for_one_asset_is_in_baht(cache, state):
    fake = FakeLLM([calls(("show_chart", {"asset_ids": ["BTC"], "period": "1Y"})),
                    text("Bitcoin is down about 24% over the past year.")])
    reply = ask(Assistant(fake, state, cache), "show me past performance of BTC", snapshot={**SNAPSHOT, "screen": "home"})
    card = reply.ui_actions[0]
    assert card["card_type"] == "chart" and card["data"]["unit"] == "THB"
    points = card["data"]["series"][0]["points"]
    assert len(points) == 40 and points[-1][1] > 1_000_000  # baht, not dollars
    assert "points" not in json.dumps(tool_results(fake, 1)[0])  # the model gets the summary, not 40 points


def test_comparing_assets_charts_change_in_percent(cache, state):
    fake = FakeLLM([calls(("show_chart", {"asset_ids": ["BTC", "XAU"], "period": "1M"})), text("ok")])
    reply = ask(Assistant(fake, state, cache), "compare bitcoin and gold", snapshot={**SNAPSHOT, "screen": "home"})
    data = reply.ui_actions[0]["data"]
    assert data["unit"] == "%" and [s["asset_id"] for s in data["series"]] == ["BTC", "XAU"]
    assert all(s["points"][0][1] == 0 for s in data["series"])  # both start at 0%


def test_chart_of_the_asset_on_screen_switches_the_real_chart(cache, state):
    fake = FakeLLM([calls(("show_chart", {"asset_ids": ["XAU"], "period": "1Y"})), text("ok")])
    reply = ask(Assistant(fake, state, cache), "show gold over a year", snapshot=SNAPSHOT)  # on Gold's page
    assert reply.ui_actions == [{"type": "set_period", "period": "1Y"},
                                {"type": "highlight", "element_id": "asset.chart"}]


def test_chart_refuses_assets_without_data(cache, state):
    fake = FakeLLM([calls(("show_chart", {"asset_ids": ["AAPL"], "period": "1M"})), text("ok")])
    reply = ask(Assistant(fake, state, cache), "apple chart", snapshot=SNAPSHOT)
    assert reply.ui_actions == [] and tool_results(fake, 1)[0]["reason"] == "no_data"


def test_steps_card_comes_from_the_reviewed_file(cache, state):
    fake = FakeLLM([calls(("show_steps", {"topic": "buy"})), text("Here's how, step by step.")])
    reply = ask(Assistant(fake, state, cache), "how do I buy?", snapshot={**SNAPSHOT, "screen": "home"})
    card = reply.ui_actions[0]
    assert card["card_type"] == "steps" and card["data"]["title"] == "How to buy"
    steps = card["data"]["steps"]
    assert [s["n"] for s in steps] == [1, 2, 3, 4, 5]
    assert steps[1]["show_me"] == [{"type": "open_asset", "asset": "XAU"},
                                   {"type": "highlight", "element_id": "asset.buy_button"}]
    assert steps[2]["show_me"] == []  # the buy screen isn't open, so nothing to point at yet
    for step in steps:
        for action in step["show_me"]:
            ui.validate(action)


def test_one_card_per_reply_and_a_trade_wins(cache, state):
    fake = FakeLLM([calls(("show_steps", {"topic": "buy"}), ("show_chart", {"asset_ids": ["BTC"], "period": "1M"}),
                          ("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})), text("ok")])
    reply = ask(Assistant(fake, state, cache), "everything", snapshot=SNAPSHOT)
    assert [a["card_type"] for a in reply.ui_actions if a["type"] == "card"] == ["trade_preview"]


def test_every_howto_topic_is_complete():
    elements = knowledge.ui_elements()
    for topic, t in knowledge.howto().items():
        assert len(t["en"]["steps"]) == len(t["th"]["steps"]) >= 2, topic
        for step in t["en"]["steps"] + t["th"]["steps"]:
            assert step["element_id"] is None or step["element_id"] in elements, (topic, step)


def test_market_endpoint_gives_the_app_baht_prices(cache):
    api = TestClient(create_app(llm=FakeLLM([]), offline=True, poll=False))
    m = api.get("/market").json()
    assert m["currency"] == "THB"
    assert set(m["assets"]) <= {"BTC", "ETH", "XAU"}  # app ids; no data for AAPL and TSLA
    gold = m["assets"]["XAU"]
    assert gold["price_thb"] > 50_000 and set(gold["change_pct"]) >= {"1D", "1W", "1M", "1Y"}


def test_with_a_chart_or_steps_card_only_the_headline_is_said(cache, state):
    from app.assistant.checks import first_sentence
    # caught live: the model read every step out loud next to the steps card
    fake = FakeLLM([calls(("show_steps", {"topic": "buy"})),
                    text("To buy, go to its page and tap Buy. Enter the amount. Review and confirm.")])
    reply = ask(Assistant(fake, state, cache), "how do I buy?", snapshot={**SNAPSHOT, "screen": "home"})
    assert reply.text == "To buy, go to its page and tap Buy."
    assert first_sentence("Bitcoin is down about 24%. The chart shows the rest.") == "Bitcoin is down about 24%."
    assert len(first_sentence("ก" * 100 + " " + "ข" * 100)) <= 160


def test_trade_replies_are_not_trimmed(cache, state):
    fake = FakeLLM([calls(("prepare_trade", {"asset_id": "XAU", "side": "buy", "amount_thb": 1000})),
                    text("Here's your preview. The fee is 5 baht. Tap Confirm on the card.")])
    reply = ask(Assistant(fake, state, cache), "buy gold 1000", snapshot=SNAPSHOT)
    assert reply.text.endswith("Tap Confirm on the card.")
