from copy import deepcopy
from decimal import Decimal
import pytest
from fastapi.testclient import TestClient

from app.demo_intents import parse_intent
from app.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app(offline=True, poll=False, model_offline=True)) as client:
        yield client


@pytest.mark.parametrize("text,action", [
    ("Show me gold", "open_asset"), ("ดูทองคำ", "open_asset"),
    ("Switch to one year", "navigate"), ("Freeze my card", "toggle_freeze"),
    ("Hide my balance", "hide_balance"), ("How do I buy?", "card"),
    ("Compare bitcoin and gold over a year", "card"), ("Walk me through buying bitcoin", "start_guide"),
    ("Walk me through buying gold step by step", "start_guide"),
])
def test_demo_intents_work_without_gateway(client, text, action):
    response = client.post("/chat", json={"text": text, "user_id": "u_new"})
    assert response.status_code == 200
    reply = response.json()
    assert reply["status"] == "ok"
    assert any(a["type"] == action for a in reply["ui_actions"])
    assert reply["debug"]["route"] == "demo_intent"


@pytest.mark.parametrize("text", [
    "Don't put 1000 baht in gold", "Should I put 1000 baht in gold?", "If I buy 1000 baht of gold",
    "Put 1000 baht in gold and buy bitcoin", "Put 1.0001 baht in gold", "Put -1000 baht in gold",
    "What if I buy 1000 baht of gold", "ซื้อทองคำ 1000 บาท แล้วซื้อบิทคอยน์", "Confirm the purchase",
])
def test_only_explicit_complete_commands_can_prepare(text):
    assert parse_intent(text) is None


def test_demo_buy_confirm_updates_shared_account_only_on_tap(client):
    before = client.get("/demo/state/u_new").json()
    reply = client.post("/chat", json={"text": "Put 1,000 baht in gold", "user_id": "u_new"}).json()
    card = next(a["data"] for a in reply["ui_actions"] if a["type"] == "card")
    assert card["you_pay_thb"] == 1000 and card["fee_thb"] == 5
    assert client.get("/demo/state/u_new").json()["cash_thb"] == before["cash_thb"]
    endpoint = f"/trades/{card['preview_id']}/confirm"
    first = client.post(endpoint, json={"user_id": "u_new"}).json()
    assert client.post(endpoint, json={"user_id": "u_new"}).json() == first
    after = client.get("/demo/state/u_new").json()
    assert after["cash_thb"] == before["cash_thb"] - 1000
    assert after["holdings"]["XAU"] == round(before["holdings"]["XAU"] + card["qty"], 8)
    portfolio = client.post("/chat", json={"text": "What is in my portfolio?", "user_id": "u_new"}).json()
    positions = portfolio["evidence"][0]["data"]["data"]["positions"]
    assert next(p for p in positions if p["asset"] == "cash")["value"] == f"{after['cash_thb']:.2f}"
    assert "simulated portfolio" in portfolio["speech"]


def test_manual_trade_uses_same_fee_and_cancellation_is_enforced(client):
    manual = client.post("/trades/preview", json={"user_id": "u_new", "asset_id": "gold", "amount_thb": 1000}).json()
    assert manual["fee_thb"] == 5
    url = f"/trades/{manual['preview_id']}"
    assert client.post(url + "/cancel", json={"user_id": "u_small"}).status_code == 404
    assert client.post(url + "/cancel", json={"user_id": "u_new"}).json()["status"] == "cancelled"
    assert client.post(url + "/confirm", json={"user_id": "u_new"}).status_code == 409


def test_new_preview_invalidates_old_preview(client):
    body = {"user_id": "u_new", "asset_id": "gold", "amount_thb": 1000}
    old = client.post("/trades/preview", json=body).json()
    new = client.post("/trades/preview", json=body).json()
    assert new["preview_id"] != old["preview_id"]
    assert client.post(f"/trades/{old['preview_id']}/confirm", json={"user_id": "u_new"}).status_code == 409


def test_exact_displayed_chart_and_mismatched_version(client):
    bundle = client.get("/demo/state/u_new").json()
    chart = bundle["assets"]["XAU"]["charts"]["1M"]
    ctx = {"screen": "asset", "asset": {"id": "XAU"}, "period": "1M", "screen_revision": "screen-7",
           "display_version": chart["display_version"], "chart": {"start": "forged", "end": 999999}}
    response = client.post("/chat", json={"text": "What does this Gold chart mean?", "snapshot": ctx}).json()
    assert response["status"] == "ok"
    data = response["evidence"][0]["data"]["data"]
    assert data["first_displayed_price"] == chart["points"][0]["price"]
    assert data["last_displayed_price"] == chart["points"][-1]["price"]
    assert data["source"]["delivery"] == "snapshot"
    assert chart["display_version"] not in response["speech"]
    ctx["display_version"] = "outdated"
    changed = client.post("/chat", json={"text": "/chart", "snapshot": ctx}).json()
    assert changed["status"] == "data_unavailable"
    assert changed["evidence"][0]["data"]["data"]["code"] == "SCREEN_OR_CHART_VERSION_CHANGED"


@pytest.mark.parametrize("fields", [{"amount_thb": -1}, {"amount_thb": 100.001}, {"asset_id": "aapl"}, {"side": "execute"}])
def test_manual_preview_input_validation(client, fields):
    body = {"user_id": "u_new", "asset_id": "gold", "amount_thb": 1000, **fields}
    assert client.post("/trades/preview", json=body).status_code == 422


def test_fee_rounding_matches_model_at_half_cent(client):
    preview = client.post("/trades/preview", json={"user_id": "u_new", "asset_id": "gold", "amount_thb": 2002}).json()
    fee = client.post("/chat", json={"text": "/fee 2002", "user_id": "u_new"}).json()
    model_fee = fee["evidence"][0]["data"]["data"]["fee"]
    assert preview["fee_thb"] == 5.01 == float(model_fee)


def test_a_frozen_card_blocks_buying_through_icarus_too():
    snap = {"screen": "home", "label": "Home", "language": "en", "card_frozen": True,
            "asset": {"id": "XAU", "name": "Gold", "price_thb": 139000, "change_24h_pct": 0.2}, "period": "1M"}
    with TestClient(create_app(engine="model", offline=True, poll=False, model_offline=True)) as client:
        frozen = client.post("/chat", json={"text": "Put 1,000 baht in gold", "user_id": "u_new", "snapshot": snap}).json()
        assert frozen["ui_actions"] == [] and "frozen" in frozen["text"]
        assert "บัตร" in client.post("/chat", json={"text": "ซื้อทอง 1,000 บาท", "user_id": "u_new",
                                                    "snapshot": {**snap, "language": "th"}, "lang": "th"}).json()["text"]
        normal = client.post("/chat", json={"text": "Put 1,000 baht in gold", "user_id": "u_new",
                                            "snapshot": {**snap, "card_frozen": False}}).json()
        assert normal["ui_actions"], "a card that is not frozen can still buy"


@pytest.mark.parametrize("phrase", ["compare gold to btc", "Compare gold with bitcoin", "compare bitcoin versus gold", "compare btc vs. eth", "compare gold against ethereum"])
def test_compare_accepts_the_natural_ways_to_say_it(phrase):
    name, args = parse_intent(phrase)
    assert name == "show_chart" and len(args["asset_ids"]) == 2 and args["period"] == "1Y"
