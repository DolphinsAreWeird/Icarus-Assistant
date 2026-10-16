"""LLM_CHAIN: several providers raced, with hedging, failover and cooldowns. A fake transport plays them all."""
import json
import time

import httpx
import pytest

from app.assistant.llm import DUMMY_SIGNATURE, THINKING_TOKENS, PRESETS, ChatModel, LLMError, ModelChain, RateLimited

TOOLS = [{"type": "function", "function": {"name": "get_prices", "parameters": {"type": "object", "properties": {}}}}]
USER = [{"role": "user", "content": "btc?"}]


def answer(text="ok"):
    return {"choices": [{"message": {"role": "assistant", "content": text}, "finish_reason": "stop"}]}


class Fake:
    """One fake server for every provider: per model, how long to wait and what to answer."""

    def __init__(self, plan):
        self.plan, self.seen, self.bodies = plan, [], []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        self.seen.append(body["model"])
        self.bodies.append(body)
        delay, status, payload, headers = self.plan[body["model"]]
        time.sleep(delay)
        if status == "timeout":
            raise httpx.ReadTimeout("slow", request=request)
        return httpx.Response(status, json=payload, headers=headers or {})


def chain(plan, providers=None, hedge_s=0.05, cooldown_s=60, timeout_s=2.0, clock=time.monotonic):
    fake = Fake(plan)
    client = httpx.Client(transport=httpx.MockTransport(fake))
    entries = [ChatModel((providers or {}).get(m, "groq"), "https://x/v1", m, "key", {}, timeout_s, client) for m in plan]
    return ModelChain(entries, hedge_s=hedge_s, cooldown_s=cooldown_s, timeout_s=timeout_s, clock=clock), fake


OK, BUSY, LIMIT = (0, 200, answer(), None), (0, 503, {"error": "busy"}, None), (0, 429, {"error": "quota"}, None)


def test_first_answer_wins_and_says_which_model():
    llm, fake = chain({"a": OK, "b": OK})
    msg, finish = llm.complete(USER, TOOLS)
    assert msg["content"] == "ok" and finish == "stop"
    assert fake.seen == ["a"] and llm.last_model == "a" and llm.last_provider == "groq"


def test_a_slow_first_entry_is_hedged_by_the_next():
    llm, fake = chain({"slow": (1.0, 200, answer("late"), None), "fast": (0, 200, answer("quick"), None)}, hedge_s=0.05)
    started = time.monotonic()
    msg, _ = llm.complete(USER, TOOLS)
    assert msg["content"] == "quick" and llm.last_model == "fast"
    assert time.monotonic() - started < 0.8  # didn't wait for the slow one
    assert "slow" not in llm.cooling()      # slow but not failed: no cooldown


def test_an_error_starts_the_next_entry_at_once_and_cools_down():
    llm, fake = chain({"busy": BUSY, "limited": LIMIT, "good": OK}, hedge_s=10)
    started = time.monotonic()
    assert llm.complete(USER, TOOLS)[0]["content"] == "ok"
    assert time.monotonic() - started < 1  # no hedge wait: errors move on immediately
    assert fake.seen == ["busy", "limited", "good"]
    assert set(llm.cooling()) == {"groq:busy", "groq:limited"}
    fake.seen.clear()
    llm.complete(USER, TOOLS)
    assert fake.seen == ["good"]  # cooling entries are skipped


def test_cooldown_ends_and_a_daily_quota_cools_for_longer():
    now = [1000.0]
    google_quota = {"error": {"code": 429, "details": [{"@type": "type.googleapis.com/google.rpc.RetryInfo",
                                                        "retryDelay": "83555s"}]}}
    llm, fake = chain({"quota": (0, 429, [google_quota], None), "busy": BUSY, "good": OK},
                      cooldown_s=60, clock=lambda: now[0])
    llm.complete(USER, TOOLS)
    cooling = llm.cooling()
    assert cooling["groq:busy"] == 60 and cooling["groq:quota"] == 3600  # capped at an hour
    now[0] += 61
    fake.seen.clear()
    llm.complete(USER, TOOLS)
    assert fake.seen == ["busy", "good"]  # back after its cooldown; the quota one still waits


def test_when_everything_is_cooling_it_tries_anyway():
    now = [0.0]
    plan = {"a": BUSY, "b": BUSY}
    llm, fake = chain(plan, clock=lambda: now[0])
    with pytest.raises(LLMError):
        llm.complete(USER, TOOLS)
    plan["b"] = OK
    fake.seen.clear()
    assert llm.complete(USER, TOOLS)[0]["content"] == "ok"
    assert fake.seen == ["a", "b"]


def test_cooling_entries_are_a_last_resort():
    now = [0.0]
    plan = {"a": BUSY, "b": OK}
    llm, fake = chain(plan, clock=lambda: now[0])
    llm.complete(USER, TOOLS)          # a cools down
    plan["b"] = BUSY
    plan["a"] = OK
    fake.seen.clear()
    assert llm.complete(USER, TOOLS)[0]["content"] == "ok"
    assert fake.seen == ["b", "a"]     # b first; a only once nothing else was left


def test_all_rate_limited_is_a_rate_limit_and_a_bad_request_moves_on():
    llm, _ = chain({"a": LIMIT, "b": LIMIT})
    with pytest.raises(RateLimited):
        llm.complete(USER, TOOLS)
    llm, fake = chain({"bad": (0, 400, {"error": "bad"}, None), "good": OK})
    assert llm.complete(USER, TOOLS)[0]["content"] == "ok"
    assert llm.cooling() == {}  # a bad request is about the request, not the provider


def test_an_empty_answer_does_not_win_the_race():
    llm, fake = chain({"empty": (0, 200, answer(""), None), "slow": (0.3, 200, answer("a real one"), None)}, hedge_s=0.05)
    assert llm.complete(USER, TOOLS)[0]["content"] == "a real one" and llm.last_model == "slow"
    assert llm.cooling() == {}  # a model quirk, not an outage
    llm, fake = chain({"empty": (0, 200, answer("<think>hmm</think>"), None), "also": (0, 200, answer(" "), None)})
    msg, finish = llm.complete(USER, TOOLS)  # nothing better came: the empty one, the turn's own fallback follows
    assert msg["content"] == "<think>hmm</think>" and llm.last_model == "empty"


def test_a_timeout_or_a_hang_moves_on_and_cools_down(monkeypatch):
    llm, fake = chain({"timeout": (0, "timeout", None, None), "good": OK}, hedge_s=10)
    assert llm.complete(USER, TOOLS)[0]["content"] == "ok"
    assert "groq:timeout" in llm.cooling()
    monkeypatch.setattr("app.assistant.llm.GRACE_S", 0.05)
    llm, fake = chain({"hang": (0.6, 200, answer("too late"), None), "good": OK}, hedge_s=10, timeout_s=0.1)
    started = time.monotonic()
    assert llm.complete(USER, TOOLS)[0]["content"] == "ok"  # gave up on it after timeout + grace
    assert time.monotonic() - started < 0.5 and "groq:hang" in llm.cooling()


def test_messages_are_adapted_per_provider():
    signed = {"google": {"thought_signature": "abc"}}
    history = [{"role": "user", "content": "gold?"},
               {"role": "assistant", "content": "", "tool_calls": [
                   {"id": "c1", "type": "function", "function": {"name": "get_prices", "arguments": "{}"},
                    "extra_content": signed}]},
               {"role": "tool", "tool_call_id": "c1", "content": "{}"},
               {"role": "assistant", "content": "", "reasoning_content": "hmm", "tool_calls": [
                   {"id": "c2", "type": "function", "function": {"name": "get_prices", "arguments": "{}"}}]},
               {"role": "tool", "tool_call_id": "c2", "content": "{}"},
               {"role": "user", "content": "and bitcoin?"}]
    llm, fake = chain({"gemini-3-flash": OK, "Qwen 3.8-27B": OK, "llama": OK},
                      providers={"gemini-3-flash": "gemini", "Qwen 3.8-27B": "orion", "llama": "groq"})
    for e in llm.entries:
        e._complete_with(e.model, history, TOOLS)
    gemini, qwen, groq = fake.bodies
    # Gemini keeps its own signature and gets Google's stand-in on a call another provider made
    assert gemini["messages"][1]["tool_calls"][0]["extra_content"] == signed
    assert gemini["messages"][3]["tool_calls"][0]["extra_content"] == DUMMY_SIGNATURE
    # the others never see Gemini's field; Qwen gets its soft switch on the last user message only
    for body in (qwen, groq):
        assert all("extra_content" not in c for m in body["messages"] for c in m.get("tool_calls", []))
        assert all("reasoning_content" not in m for m in body["messages"])
    assert qwen["messages"][-1]["content"] == "and bitcoin? /no_think" and qwen["messages"][0]["content"] == "gold?"
    assert groq["messages"][-1]["content"] == "and bitcoin?"
    assert history[-1]["content"] == "and bitcoin?" and "extra_content" not in history[3]["tool_calls"][0]  # untouched


def test_no_tools_and_room_to_think():
    llm, fake = chain({"gemini-3-flash": OK, "Qwen 3.8-27B": OK, "icarus": OK},
                      providers={"gemini-3-flash": "gemini", "Qwen 3.8-27B": "orion", "icarus": "ollama"})
    llm.entries[0].extra = {"reasoning_effort": "low"}
    for e in llm.entries:
        e._complete_with(e.model, USER, [], max_tokens=60)
    gemini, qwen, ollama = fake.bodies
    assert "tools" not in gemini and "tool_choice" not in gemini
    assert gemini["max_tokens"] == qwen["max_tokens"] == 60 + THINKING_TOKENS  # thinking counts in max_tokens
    assert ollama["max_tokens"] == 60


def test_llm_chain_from_env(monkeypatch):
    monkeypatch.delenv("LLM_TIMEOUT_S", raising=False)
    monkeypatch.setenv("LLM_CHAIN", "orion:Qwen 3.8-27B, gemini:gemini-3.1-flash-lite ,groq:llama-3.3-70b-versatile,"
                                    "nope:x")
    monkeypatch.setenv("ICARUS_LLM_API_KEY", "k1")
    monkeypatch.setenv("GEMINI_API_KEY", "k2")
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    monkeypatch.setenv("LLM_HEDGE_MS", "1500")
    llm = ChatModel.from_env()
    assert isinstance(llm, ModelChain) and llm.hedge_s == 1.5 and llm.timeout_s == 6
    assert llm.model == "orion:Qwen 3.8-27B,gemini:gemini-3.1-flash-lite"  # no Groq key, unknown provider: skipped
    assert llm.entries[0].base_url == PRESETS["orion"]["base_url"]
    monkeypatch.setenv("LLM_CHAIN", "groq:llama-3.3-70b-versatile")
    with pytest.raises(LLMError):
        ChatModel.from_env()
    monkeypatch.setenv("GROQ_API_KEY", "k3")
    assert ChatModel.from_env().entries[0].extra == {}  # llama takes no reasoning_effort


def test_without_llm_chain_nothing_changes(monkeypatch):
    monkeypatch.delenv("LLM_CHAIN", raising=False)
    monkeypatch.delenv("LLM_TIMEOUT_S", raising=False)
    monkeypatch.setenv("LLM_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", "k")
    monkeypatch.setenv("LLM_MODEL", "a,b")
    llm = ChatModel.from_env()
    assert type(llm) is ChatModel and llm.model == "a,b" and llm.timeout == 60
