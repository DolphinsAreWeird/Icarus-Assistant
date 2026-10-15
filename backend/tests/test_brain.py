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

PROTOTYPE = Path(__file__).resolve().parents[2] / "frontend" / "prototype" / "Icarus Prototype.dc.html"

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
    assert set(ui.ACTIONS) <= runs


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

def test_prepare_buy_from_the_assets_own_page():
    s = ui.UIState("asset", "XAU")
    acts = ui.prepare_buy(s, "XAU", 1000)
    assert acts == [{"type": "start_buy", "asset": "XAU"}, {"type": "type_amount", "value": 1000},
                    {"type": "select_wallet", "wallet": "thb"}, {"type": "review"}]
    assert s.screen == "buy_review"


def test_prepare_buy_from_home_opens_the_asset_first():
    acts = ui.prepare_buy(ui.UIState("home", "BTC"), "XAU", 1000, "usd")
    assert types(acts) == ["open_asset", "start_buy", "type_amount", "select_wallet", "review"]
    assert acts[3] == {"type": "select_wallet", "wallet": "usd"}


def test_prepare_buy_again_on_the_buy_screen_just_retypes():
    acts = ui.prepare_buy(ui.UIState("buy_review", "XAU"), "XAU", 2000)
    assert types(acts) == ["type_amount", "select_wallet", "review"]


def test_prepare_buy_below_minimum_does_nothing():
    with pytest.raises(ui.UIError) as e:
        ui.prepare_buy(ui.UIState("asset", "XAU"), "XAU", 50)
    assert e.value.code == "below_minimum"


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
    ("asset", "buy.fee_line", ["start_buy", "highlight"]),
    ("asset", "asset.change24h", ["highlight"]),
    ("buy_review", "buy.confirm_button", ["highlight"]),
])
def test_point_at_goes_to_the_elements_screen(start, element, expected):
    assert types(ui.point_at(ui.UIState(start, "XAU"), element)) == expected


def test_point_at_confirm_needs_a_purchase_set_up():
    with pytest.raises(ui.UIError):
        ui.point_at(ui.UIState("asset", "XAU"), "buy.confirm_button")


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
    with pytest.raises(ui.UIError):
        ui.cancel_buy(ui.UIState("home"))
    assert ui.cancel_buy(ui.UIState("buy_review")) == [{"type": "cancel_buy"}]


def test_state_from_the_apps_snapshot():
    assert ui.state_from_snapshot(SNAPSHOT) == ui.UIState("asset", "XAU")
    review = {**SNAPSHOT, "screen": "buy", "label": "Buy Gold · review"}
    assert ui.state_from_snapshot(review).screen == "buy_review"
    assert ui.state_from_snapshot(None, "asset_detail", "gold") == ui.UIState("asset", "XAU")


# ---------- through the brain ----------

def test_put_1000_baht_in_gold_from_the_app(cache, state):
    fake = FakeLLM([
        calls(("prepare_buy", {"asset_id": "XAU", "amount_thb": 1000})),
        text("It's set up. Check the fee and total, then tap Confirm purchase."),
    ])
    reply = ask(Assistant(fake, state, cache), "Put 1,000 baht in gold", snapshot=SNAPSHOT)
    assert types(reply.ui_actions) == ["start_buy", "type_amount", "select_wallet", "review"]
    assert tool_results(fake, 1)[0] == {"ok": True, "done": (
        "Opened the buy screen for Gold. Typed 1000 baht. Picked the THB Wallet. Opened the review "
        "screen. The user must tap Confirm purchase; nothing is bought yet.")}
    assert reply.debug["screen_after"] == "buy_review"
    assert state.users["u_new"]["cash_thb"] == 5000.0  # nothing bought: the user taps Confirm


def test_two_intents_in_one_turn_chain_from_where_the_first_ended(cache, state):
    fake = FakeLLM([
        calls(("show_asset", {"asset_id": "BTC", "period": "1Y"}),
              ("prepare_buy", {"asset_id": "BTC", "amount_thb": 500})),
        text("Done."),
    ])
    reply = ask(Assistant(fake, state, cache), "show bitcoin over a year then set up 500 baht",
                snapshot={**SNAPSHOT, "screen": "home"})
    assert types(reply.ui_actions) == ["open_asset", "set_period", "start_buy", "type_amount",
                                       "select_wallet", "review"]  # no second open_asset


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
    fake = FakeLLM([calls(("cancel_buy", {})), text("There's no purchase open.")])
    reply = ask(Assistant(fake, state, cache), "cancel it", snapshot={**SNAPSHOT, "screen": "home"})
    assert reply.ui_actions == []
    assert tool_results(fake, 1)[0]["reason"] == "no_buy_open"


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
    assert result["data"]["numbers"]["currency"] == "USD"  # caught live: it said "baht"
    assert result["source"]["provider"] == "app screen (demo data)"
    assert reply.ui_actions == [{"type": "highlight", "target": "asset.chart"}]
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
    assert {"prepare_buy", "show_asset", "go_to_screen", "explain_element"} <= names
    assert "prepare_trade" not in names


def test_tool_schemas_use_the_apps_ids():
    specs = {t["function"]["name"]: t["function"]["parameters"] for t in tool_specs()}
    app = knowledge.app_ui()
    assert specs["prepare_buy"]["properties"]["asset_id"]["enum"] == list(app["assets"])
    assert specs["prepare_buy"]["required"] == ["asset_id", "amount_thb"]
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

def test_api_with_the_voice_servers_request(cache):
    fake = FakeLLM([calls(("prepare_buy", {"asset_id": "XAU", "amount_thb": 1000})),
                    text("Set up. Tap Confirm purchase when you're happy.")])
    api = TestClient(create_app(llm=fake, offline=True, poll=False))
    assert api.get("/health").json()["assistant"] == "fake/scripted"
    assert len(api.get("/history/gold?period=1W").json()["rows"]) == 168

    reply = api.post("/chat", json={"text": "Put 1,000 baht in gold", "language": "en",
                                    "snapshot": SNAPSHOT, "userId": "demo-user"}).json()
    assert types(reply["ui_actions"]) == ["start_buy", "type_amount", "select_wallet", "review"]
    assert reply["speak"] is False and reply["sources"] == []

    err = api.post("/chat", json={"text": "hi", "user_id": "nobody"})
    assert err.status_code == 404 and err.json()["detail"]["code"] == "unknown_user"
