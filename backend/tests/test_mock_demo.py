import pytest
from fastapi.testclient import TestClient

from app import mock_demo
from app.main import create_app

HEARD = ["Hey Icarus, I want to buy 1000 baht of gold", "Hey Icarus, I want to buy 1,000 baht of gold.", "hey icarus i want to buy a thousand bath of gold",
         "I want to buy one thousand baht of Gold", "Hey Icarus, buy 1000 THB of gold please", "i want to buy 1k baht of gold", "Can I purchase 1000 baht of gold?"]


@pytest.mark.parametrize("text", HEARD)
def test_every_way_of_hearing_the_demo_request_is_the_same_request(text):
    assert mock_demo.canonical(text) == "buy 1000 baht of gold"


@pytest.mark.parametrize("text", ["sell 1000 baht of gold", "don't buy 1000 baht of gold", "should I buy 1000 baht of gold", "buy gold",
                                  "buy 1000 baht of gold and 500 baht of bitcoin", "what is gold", "buy 1000 baht of tesla"])
def test_anything_else_is_left_for_the_normal_engine(text):
    assert mock_demo.canonical(text) is None


def test_the_live_demo_answers_the_same_every_time(monkeypatch):
    monkeypatch.setenv("ICARUS_MOCK", "1")
    monkeypatch.setenv("LLM_PROVIDER", "none")
    replies = []
    for _ in range(2):
        with TestClient(create_app(poll=False)) as c:
            for text in HEARD:
                r = c.post("/chat", json={"user_id": "demo-user", "session_id": "m", "text": text, "lang": "en", "input_mode": "voice"}).json()
                replies.append((r["text"], r["status"], tuple(a.get("card_type") or a["type"] for a in r["ui_actions"]), r["debug"]["model_calls"]))
    assert len(set(replies)) == 1
    text, status, actions, calls = replies[0]
    assert status == "ok" and calls == 0 and actions == ("open_asset", "trade_preview")
    assert text == "Here's your preview: 1,000 baht of gold, about 0.22 grams, with a 5 baht fee included. Tap Confirm on the card to buy."
