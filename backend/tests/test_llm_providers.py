"""ChatModel against provider quirks: Gemini 3's thought signatures, several models when one is busy."""
import httpx
import pytest

from app.assistant.llm import ChatModel, LLMError, RateLimited


class Reply:
    def __init__(self, status, body=None, headers=None):
        self.status_code, self._body, self.headers, self.text = status, body or {}, headers or {}, str(body)

    def json(self):
        return self._body


def tool_reply(extra=None):
    call = {"id": "c1", "type": "function", "function": {"name": "get_prices", "arguments": '{"asset_ids":["btc"]}'}}
    if extra:
        call["extra_content"] = extra
    return Reply(200, {"choices": [{"message": {"role": "assistant", "tool_calls": [call]}, "finish_reason": "tool_calls"}]})


TOOLS = [{"type": "function", "function": {"name": "get_prices", "parameters": {"type": "object", "properties": {}}}}]


def model(name="m1"):
    return ChatModel("gemini", "https://x/v1", name, "key", {})


def test_keeps_geminis_thought_signature_on_tool_calls(monkeypatch):
    signature = {"google": {"thought_signature": "abc"}}
    monkeypatch.setattr(httpx, "post", lambda *a, **k: tool_reply(signature))
    msg, _ = model().complete([{"role": "user", "content": "btc?"}], TOOLS)
    assert msg["tool_calls"][0]["extra_content"] == signature


def test_adds_nothing_for_providers_that_send_no_signature(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: tool_reply())
    msg, _ = model().complete([{"role": "user", "content": "btc?"}], TOOLS)
    assert "extra_content" not in msg["tool_calls"][0]


def test_next_model_answers_when_one_is_rate_limited_or_busy(monkeypatch):
    seen = []

    def post(url, json, **_):
        seen.append(json["model"])
        if json["model"] == "busy":
            return Reply(503, {"error": "high demand"})
        if json["model"] == "limited":
            return Reply(429, {"error": "quota"}, {"retry-after": "30"})
        return tool_reply()

    monkeypatch.setattr(httpx, "post", post)
    msg, _ = model("limited, busy, good").complete([{"role": "user", "content": "btc?"}], TOOLS)
    assert seen == ["limited", "busy", "good"]
    assert msg["tool_calls"][0]["function"]["name"] == "get_prices"


def test_a_timeout_moves_on_and_a_bad_request_does_not(monkeypatch):
    def slow_then_ok(url, json, **_):
        if json["model"] == "slow":
            raise httpx.ReadTimeout("slow")
        return tool_reply()

    monkeypatch.setattr(httpx, "post", slow_then_ok)
    assert model("slow,good").complete([{"role": "user", "content": "x"}], TOOLS)[0]["tool_calls"]
    monkeypatch.setattr(httpx, "post", lambda *a, **k: Reply(400, {"error": "bad"}))
    with pytest.raises(LLMError) as e:
        model("a,b").complete([{"role": "user", "content": "x"}], TOOLS)
    assert not isinstance(e.value, RateLimited)


def test_all_models_limited_is_a_rate_limit(monkeypatch):
    monkeypatch.setattr(httpx, "post", lambda *a, **k: Reply(429, {}, {"retry-after": "60"}))
    with pytest.raises(RateLimited):
        model("a,b").complete([{"role": "user", "content": "x"}], TOOLS)
