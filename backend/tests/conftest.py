import pytest


@pytest.fixture(autouse=True)
def no_question_log(monkeypatch):
    """Tests don't write the question log (backend/.runtime/questions.jsonl)."""
    monkeypatch.setenv("QUESTION_LOG", "0")
