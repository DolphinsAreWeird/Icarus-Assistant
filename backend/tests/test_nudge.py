"""Proactive help: rule-based, no model. The app measures the idle time; this decides what to say."""
import re

import pytest
from fastapi.testclient import TestClient

from app import knowledge, nudge, ui
from app.main import create_app


def snap(screen, label=None, buy=None, frozen=False, lang="en"):
    return {"screen": screen, "label": label or screen, "language": lang, "card_frozen": frozen, "buy": buy,
            "asset": {"id": "XAU", "name": "Gold", "price_thb": 139000}, "period": "1M"}


def amount(total, wallet="thb"):
    return {"amount_thb": total, "fee_thb": 0, "total_thb": total, "wallet": wallet}


BUY = "Buy Gold · amount"
CASES = [  # (snapshot, cash, reason, highlight)
    (snap("buy", BUY, amount(0), frozen=True), 5000, "card_frozen", None),
    (snap("buy", BUY, amount(500, "usd")), 5000, "wrong_wallet", None),
    (snap("buy", BUY, amount(50)), 5000, "below_minimum", "buy.amount_input"),
    (snap("buy", BUY, amount(9000)), 5000, "not_enough_cash", "buy.amount_input"),
    (snap("buy", BUY, amount(0)), 5000, "empty_amount", "buy.amount_input"),
    (snap("buy", BUY, amount(1000)), 5000, "ready_to_review", "buy.review_button"),
    (snap("buy", "Buy Gold · review", amount(1000)), 5000, "review_waiting", "buy.confirm_button"),
    (snap("payments"), 5000, "payments_dead_end", None),
    (snap("card"), 5000, "card_screen", None),
]


@pytest.mark.parametrize("snapshot, cash, reason, highlight", CASES)
@pytest.mark.parametrize("lang", ["en", "th"])
def test_each_rule_in_both_languages(snapshot, cash, reason, highlight, lang):
    n = nudge.decide(snapshot, cash, lang)
    assert n["reason"] == reason and n["highlight"] == highlight
    assert n["text"] and not re.search(r"[{}]", n["text"])  # every placeholder was filled
    if lang == "th":
        assert re.search(r"[฀-๿]", n["text"])
    for chip in n["suggestions"]:
        assert chip


def test_frozen_beats_everything_on_the_buy_screens():
    assert nudge.decide(snap("buy", "Buy Gold · review", amount(1000), frozen=True), 5000)["reason"] == "card_frozen"
    assert nudge.decide(snap("buy", BUY, amount(50), frozen=True), 5000)["reason"] == "card_frozen"


@pytest.mark.parametrize("screen", ["home", "wallets", "invest", "portfolio", "asset"])
def test_nothing_to_say_on_the_other_screens(screen):
    assert nudge.decide(snap(screen), 5000) is None


def test_nothing_to_say_once_the_purchase_is_done():
    assert nudge.decide(snap("buy", "Buy Gold · complete", amount(1000)), 5000) is None


def test_numbers_come_from_data_only():
    n = nudge.decide(snap("buy", BUY, amount(9000)), 4010.5, "en")
    assert n["text"] == "You have 4,010.50 baht available. Try a smaller amount."
    assert nudge.decide(snap("buy", BUY, amount(50)), 5000, "en")["text"] == "The minimum is 100 baht. Try a bigger amount."
    digits = {m for n_ in map(lambda c: nudge.decide(*c[:2]), CASES) if n_ for m in re.findall(r"\d[\d,.]*", n_["text"])}
    assert digits <= {"100", "5,000"}  # the minimum and the test user's cash, nothing else


def test_wording_is_safe():
    advice = re.compile(r"\b(should|recommend|good time|best|invest in|don't miss|hurry|now or never)\b", re.I)
    for reason, texts in nudge.TEXT.items():
        assert set(texts) == {"en", "th"}, reason
        assert not advice.search(texts["en"]), reason
    # the review nudge never pushes the buy
    assert "Nothing is bought until you tap Confirm purchase" in nudge.TEXT["review_waiting"]["en"]


def test_highlights_are_real_elements_on_the_current_screen_and_there_is_no_confirm_action():
    elements = knowledge.app_ui()["elements"]
    for snapshot, cash, reason, highlight in CASES:
        n = nudge.decide(snapshot, cash)
        if n["highlight"]:
            ui.validate({"type": "highlight", "element_id": n["highlight"]})
            assert elements[n["highlight"]]["screen"] == ui.state_from_snapshot(snapshot).screen
    assert not any("confirm" in t or "execute" in t for t in ui.ACTIONS)


def test_chips_are_phrases_icarus_already_understands():
    from app.demo_intents import parse_intent
    for chip in nudge.CHIPS.values():
        for lang in ("en", "th"):
            assert parse_intent(chip[lang]) is not None, chip[lang]


@pytest.fixture
def client():
    with TestClient(create_app(engine="model", offline=True, poll=False, model_offline=True)) as client:
        yield client


def test_nudge_endpoint(client):
    r = client.post("/nudge", json={"user_id": "demo-user", "idle_s": 15,
                                    "snapshot": snap("buy", BUY, amount(50))}).json()["nudge"]
    assert r["reason"] == "below_minimum" and r["highlight"] == "buy.amount_input"
    th = client.post("/nudge", json={"user_id": "u_new", "snapshot": snap("buy", BUY, amount(50), lang="th")}).json()["nudge"]
    assert "ขั้นต่ำ" in th["text"]  # the language comes from the snapshot when lang is not sent
    over = client.post("/nudge", json={"user_id": "u_new", "snapshot": snap("buy", BUY, amount(9000))}).json()["nudge"]
    assert over["reason"] == "not_enough_cash" and "5,000 baht" in over["text"]  # u_new's real cash
    assert client.post("/nudge", json={"snapshot": snap("home")}).json() == {"nudge": None}


def test_nudge_endpoint_unknown_user(client):
    r = client.post("/nudge", json={"user_id": "nobody", "snapshot": snap("card")})
    assert r.status_code == 404 and r.json()["detail"]["code"] == "unknown_user"


def test_nudge_works_on_either_engine_and_makes_no_model_call(monkeypatch):
    # /nudge is rules only: it must never reach a model, whichever engine is running
    import app.assistant.llm as llm
    monkeypatch.setattr(llm.ChatModel, "complete", lambda *a, **k: (_ for _ in ()).throw(AssertionError("model called")))
    for engine in ("model", "legacy"):
        with TestClient(create_app(engine=engine, offline=True, poll=False)) as client:
            assert client.post("/nudge", json={"snapshot": snap("card")}).json()["nudge"]["reason"] == "card_screen"


# ---------- found by QA: the snapshot comes from a browser, so its shape can't be trusted ----------

@pytest.mark.parametrize("bad", [
    {"screen": "buy", "buy": "x"}, {"screen": "buy", "buy": {"amount_thb": "x"}}, {"screen": "buy", "buy": {"amount_thb": [1]}},
    {"screen": "buy", "asset": 5}, {"screen": {"a": 1}}, {"screen": 7}, {"screen": "buy", "buy": {"total_thb": "nan"}},
    {"screen": "buy", "buy": {"total_thb": "inf"}}, {"screen": "buy", "buy": None, "asset": None}, {},
])
def test_malformed_snapshots_never_crash_and_never_give_a_wrong_nudge(client, bad):
    r = client.post("/nudge", json={"user_id": "u_new", "snapshot": bad})
    assert r.status_code == 200
    nudge_ = r.json()["nudge"]
    assert nudge_ is None or nudge_["reason"] != "ready_to_review"


def test_review_label_is_matched_in_any_case(client):
    for label in ("Buy Gold · review", "Review purchase", "REVIEW"):
        r = client.post("/nudge", json={"user_id": "u_new", "snapshot": snap("buy", label, amount(500))}).json()["nudge"]
        assert r["reason"] == "review_waiting", label


def test_bad_input_has_the_apps_error_shape(client):
    for path, body in [("/chat", {}), ("/trades/preview", {}), ("/nudge", {"idle_s": "soon"})]:
        r = client.post(path, json=body)
        assert r.status_code == 422, path
        d = r.json()["detail"]
        assert d["code"] == "bad_request" and d["message_en"] and d["message_th"] and d["fields"], path


def test_demo_user_works_on_every_trade_route(client):
    r = client.post("/trades/preview", json={"user_id": "demo-user", "asset_id": "gold", "side": "buy", "amount_thb": 500})
    assert r.status_code == 200
    pid = r.json()["preview_id"]
    assert client.post(f"/trades/{pid}/cancel", json={"user_id": "demo-user"}).json()["status"] == "cancelled"
    pid2 = client.post("/trades/preview", json={"user_id": "demo-user", "asset_id": "gold", "side": "buy", "amount_thb": 500}).json()["preview_id"]
    assert client.post(f"/trades/{pid2}/confirm", json={"user_id": "demo-user"}).status_code == 200
    assert client.get("/demo/state/u_new").json()["cash_thb"] < 5000  # it really was the demo account
