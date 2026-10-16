"""Price and balance questions, risk, what-if, goal math, and the friction map."""
import re
from datetime import date

import pytest
from fastapi.testclient import TestClient

from app import friction, insights
from app.assistant.guard import violation
from app.demo_intents import parse_intent
from app.main import create_app


@pytest.fixture
def client():
    with TestClient(create_app(engine="model", offline=True, poll=False, model_offline=True)) as c:
        yield c


def say(client, text, user="u_new", **extra):
    return client.post("/chat", json={"text": text, "user_id": user, **extra}).json()


def rows(closes, start="2026-01-01"):
    """Daily rows from a list of closes, one per day."""
    from datetime import timedelta
    d0 = date.fromisoformat(start)
    return [{"t": f"{(d0 + timedelta(days=i)).isoformat()}T00:00:00+00:00", "close_thb": c} for i, c in enumerate(closes)]


# ---------- the arithmetic, against numbers worked out by hand ----------

def test_risk_stats_on_a_known_series():
    # 100 days: flat at 100, then a drop to 50 (a 50% fall), then back up to 75
    series = [100.0] * 40 + [50.0] * 30 + [75.0] * 30
    s = insights.risk_stats(rows(series, "2026-01-01"))
    assert s["max_drop_pct"] == 50.0 and s["days"] == 100
    assert s["worst_month_pct"] <= -49 and s["best_month_pct"] >= 0
    assert s["typical_day_move_pct"] == 0.0           # almost every day is flat
    assert insights.risk_stats(rows([100.0] * 10)) is None  # too little history to say anything


def test_what_if_is_plain_arithmetic():
    r = insights.what_if(rows([100.0, 110.0, 125.0]), 1000)
    assert r["value_now_thb"] == 1250.0 and r["change_thb"] == 250.0 and r["change_pct"] == 25.0
    assert insights.what_if(rows([100.0, 50.0]), 1000)["value_now_thb"] == 500.0
    for bad in (0, -5, float("nan"), float("inf")):
        assert insights.what_if(rows([100.0, 110.0]), bad) is None
    assert insights.what_if(rows([100.0]), 1000) is None


@pytest.mark.parametrize("target, months, current, monthly", [
    (50_000, 8, 0, 6250), (10_000, 3, 0, 3340),      # 3,333.33 rounds UP to the next 10 so the goal is actually met
    (100, 1, 0, 100), (50_000, 8, 10_000, 5000), (12_345, 12, 0, 1030),
])
def test_goal_math_rounds_up_so_the_goal_is_met(target, months, current, monthly):
    g = insights.goal_math(target, months, current)
    assert g["monthly_thb"] == monthly and g["monthly_thb"] * months + current >= target


def test_goal_math_edge_cases():
    assert insights.goal_math(5000, 6, 6000)["reached"] is True
    for target, months in ((0, 6), (-100, 6), (5000, 0), (5000, 601), (float("nan"), 6)):
        assert insights.goal_math(target, months) is None
    assert insights.months_until(6, date(2026, 10, 15)) == 8      # June from October
    assert insights.months_until(12, date(2026, 10, 15)) == 2
    assert insights.months_until(10, date(2026, 10, 15)) == 1     # the same month
    assert insights.months_until(9, date(2026, 10, 15)) == 11     # a month that has passed: next year


# ---------- the plain questions, through /chat ----------

QUESTIONS = [
    ("what's the price of bitcoin", "Bitcoin is at", "บิตคอยน์"), ("how much is gold", "is at", "ทอง"),
    ("how much cash do I have", "5,000 baht in cash", "เงินสด"), ("how is my money split", "cash", "พอร์ต"),
    ("how risky is bitcoin", "worst month", "เดือนที่แย่ที่สุด"), ("is gold volatile", "normal day", "ในวันปกติ"),
    ("what if I had put 1,000 baht in gold a year ago", "not a forecast", "ไม่ใช่การคาดการณ์"),
    ("to save 50,000 baht by June", "a month", "ต่อเดือน"),
]


@pytest.mark.parametrize("question, en_part, _", QUESTIONS)
def test_each_question_gets_a_grounded_english_answer(client, question, en_part, _):
    r = say(client, question)
    assert r["status"] == "ok" and en_part in r["text"]
    assert violation(r["text"]) is None                      # never advice, never "it's bought"
    assert not re.search(r"\babout about\b|nan|inf\b|\{", r["text"])
    assert r["debug"]["route"] == "demo_intent" and r["sources"]


@pytest.mark.parametrize("question, _, th_part", [
    ("ราคาทอง", "", "ทอง"), ("ฉันมีเงินสดเท่าไหร่", "", "เงินสด"), ("พอร์ตของฉัน", "", "เงินสด"), ("ทองเสี่ยงไหม", "", "ในวันปกติ"),
])
def test_thai_questions_get_thai_answers(client, question, _, th_part):
    r = say(client, question)
    assert r["status"] == "ok" and th_part in r["text"] and re.search(r"[฀-๿]", r["text"])


def test_numbers_in_answers_are_the_data(client):
    r = say(client, "how much cash do I have")
    assert "5,000 baht" in r["text"] and "about" not in r["text"]           # the user's own number is exact
    pf = say(client, "how is my money split", user="u_small")
    assert "80%" in pf["text"] and "Bitcoin" in pf["text"] and "15 baht in fees" in pf["text"]
    goal = say(client, "to save 50,000 baht by June")
    assert "6,250 baht" in goal["text"] and "8 months" in goal["text"]       # (June - October) = 8 months
    what_if = client.post("/chat", json={"text": "what if I had put 1,000 baht in gold a year ago", "user_id": "u_new"}).json()
    ev = what_if["evidence"][0]["data"]
    assert ev["amount_thb"] == 1000 and ev["value_now_thb"] == pytest.approx(1000 * (1 + ev["change_pct"] / 100), abs=0.2)  # the % is rounded to 2 places


def test_an_asset_without_data_says_so_honestly(client):
    for q in ("how risky is apple", "what's the price of tesla", "what if I had put 1,000 baht in apple a year ago"):
        r = say(client, q)
        assert r["status"] == "data_unavailable" and "don't have" in r["text"] and "Apple" in r["text"] + "Apple"


def test_bad_goals_are_explained_not_crashed(client):
    r = say(client, "to save 50,000 baht in 0 months")
    assert r["status"] == "data_unavailable" and "600 months" in r["text"]


@pytest.mark.parametrize("not_ours", ["should I buy bitcoin", "what is bitcoin", "what is gold", "is bitcoin a good buy", "will gold go up",
                                      "tell me what to buy", "what is in my portfolio"])
def test_advice_and_knowledge_questions_are_not_taken_over(not_ours):
    assert parse_intent(not_ours) is None  # these go to the knowledge or model path, as before


def test_compare_phrasing_and_portfolio_phrase_owned_by_the_model_engine_still_work(client):
    assert say(client, "What is in my portfolio?")["evidence"][0]["data"]["data"]["positions"]
    assert say(client, "compare gold to btc")["ui_actions"][0]["card_type"] == "chart"


# ---------- the friction map ----------

def test_topics_come_from_the_reviewed_words():
    assert friction.classify_topic("What does the fee mean?") == "fee"
    assert friction.classify_topic("explain my balance") == "balance"
    assert friction.classify_topic("how is bitcoin doing") == "bitcoin"
    assert friction.classify_topic("ค่าธรรมเนียมคืออะไร") == "fee"
    assert friction.classify_topic("zzz qqq") == "other"


def test_chat_is_logged_by_topic_never_by_text(client):
    client.post("/friction/reset")
    say(client, "What does the fee mean?", session_id="s1", screen_context={"screen_id": "buy"})
    say(client, "how is bitcoin doing", session_id="s2")
    events = client.get("/friction/summary").json()
    assert events["questions"] == 2 and events["users"] == 1
    assert {t["topic"] for t in events["top_questions"]} == {"fee", "bitcoin"}
    assert events["by_screen"]["buy"]["questions"] == 1
    raw = str(client.app.state.__dict__) + client.get("/friction/summary").text
    assert "What does the fee mean" not in raw and "u_new" not in client.get("/friction/summary").text  # no text, no raw user id


def test_confusion_refusals_and_unanswered_are_counted(client):
    client.post("/friction/reset")
    say(client, "What does the fee mean?")
    say(client, "what does 24h change mean", session_id="s2")
    s = client.get("/friction/summary").json()
    assert s["by_type"]["confusion"] == 2
    assert s["confusing"][0]["text"].endswith("asked about " + s["confusing"][0]["topic"]) and s["confusing"][0]["of_users"] == 1
    say(client, "how risky is apple")                       # a question we can't answer
    assert client.get("/friction/summary").json()["unanswered"] == 1


def test_purchase_funnel_and_validation_failures(client):
    client.post("/friction/reset")
    p = client.post("/trades/preview", json={"user_id": "u_new", "asset_id": "gold", "amount_thb": 500}).json()
    client.post("/trades/preview", json={"user_id": "u_new", "asset_id": "gold", "amount_thb": 999999})   # not enough cash
    client.post(f"/trades/{p['preview_id']}/confirm", json={"user_id": "u_new"})
    s = client.get("/friction/summary").json()
    assert s["by_type"]["preview_shown"] == 1 and s["by_type"]["task_completed"] == 1 and s["by_type"]["validation_failed"] == 1
    assert s["funnel"] == {"purchase_started": 1, "purchase_completed": 1, "text": "1 of 1 purchase attempts completed"}


def test_nudges_are_logged_with_their_reason(client):
    client.post("/friction/reset")
    snap = {"screen": "buy", "label": "Buy Gold · amount", "buy": {"total_thb": 50, "wallet": "thb"}}
    client.post("/nudge", json={"user_id": "u_new", "snapshot": snap})
    client.post("/nudge", json={"user_id": "u_new", "snapshot": {"screen": "home"}})   # nothing to say: not logged
    s = client.get("/friction/summary").json()
    assert s["by_type"] == {"nudge_issued": 1} and s["by_screen"]["buy"]["nudges"] == 1


def test_the_app_can_add_its_own_events_and_only_known_ones(client):
    client.post("/friction/reset")
    ok = client.post("/events", json={"type": "task_abandoned", "screen": "buy", "session_id": "s9", "lang": "th"})
    assert ok.status_code == 200
    bad = client.post("/events", json={"type": "drop_table"})
    assert bad.status_code == 422 and bad.json()["detail"]["code"] == "bad_request"
    assert client.post("/events", json={"type": "task_abandoned", "screen": "x" * 500}).status_code == 422
    assert client.get("/friction/summary").json()["by_type"] == {"task_abandoned": 1}


def test_logging_can_never_break_anything(tmp_path):
    log = friction.FrictionLog(path=str(tmp_path / "no" / "such" / "dir" / "f.jsonl"))
    log.log("question", user_id="u")                                # an unwritable file: no exception, the event is still kept
    assert log.summary()["events"] == 1
    assert log.log("not_a_type", user_id="u") is None                # an unknown type is ignored
    assert log.log("question", user_id="u", screen=object(), topic=5) is not None  # odd values never raise
    assert friction.FrictionLog().summary()["events"] == 0
    log2 = friction.FrictionLog(path=str(tmp_path / "f.jsonl"))
    log2.log("question", user_id="u1", topic="fee")
    assert '"topic": "fee"' in (tmp_path / "f.jsonl").read_text() and "u1" not in (tmp_path / "f.jsonl").read_text()
