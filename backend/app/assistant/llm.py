"""Talk to any LLM that speaks the OpenAI chat-completions format.

That covers the free options: Groq, Google Gemini, Ollama on a laptop, and CMKL's Orion gateway.
Pick one with env vars:
  LLM_PROVIDER = ollama (default) | groq | gemini | orion
  LLM_MODEL    = override the preset's model; several, comma separated, are tried in turn
  LLM_BASE_URL = override the preset's URL
Or race several providers (ModelChain below):
  LLM_CHAIN      = provider:model entries, comma separated, e.g. "orion:Qwen 3.8-27B,gemini:gemini-3.1-flash-lite".
                   Split on commas, then on the first colon only: model ids may contain spaces.
                   Entries whose API key is missing are skipped. LLM_PROVIDER and LLM_MODEL are then ignored.
  LLM_HEDGE_MS   = also start the next entry if the first hasn't answered by then (default 2000)
  LLM_COOLDOWN_S = skip an entry this long after a 429, 5xx or timeout (default 60)
  LLM_TIMEOUT_S  = per attempt (default 60 for one provider, 6 in a chain)
"""
import json
import os
import re
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import httpx

import app.config  # noqa: F401  loads backend/.env before we read keys

PRESETS = {
    "groq": {"base_url": "https://api.groq.com/openai/v1", "key_env": "GROQ_API_KEY",
             "model": "openai/gpt-oss-120b", "extra": {"reasoning_effort": "low"},
             "reasoning_models": ("openai/gpt-oss",)},  # others reject reasoning_effort
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
               "key_env": "GEMINI_API_KEY", "model": "gemini-flash-latest",
               "extra": {"reasoning_effort": "low"}},
    "ollama": {"base_url": "http://localhost:11434/v1", "key_env": None,
               "model": "icarus", "extra": {"keep_alive": "2h"}},
    # CMKL's LiteLLM gateway. Qwen thinks by default and the gateway refuses the usual switch
    # (chat_template_kwargs gives a 500), so the last user message gets Qwen's own " /no_think".
    "orion": {"base_url": "https://api.orion.cmkl.ai/v1", "key_env": "ICARUS_LLM_API_KEY",
              "model": "Qwen 3.8-27B", "extra": {}, "no_think": ("qwen",)},
}

# Google's documented stand-in for a function call Gemini 3 didn't make itself (another provider's,
# or one parsed from text). Without a signature it answers 400; checked with a real call.
DUMMY_SIGNATURE = {"google": {"thought_signature": "skip_thought_signature_validator"}}
# Thinking models count their thinking in max_tokens: with 60, Gemini stopped at "Gold is currently".
THINKING_TOKENS = 256


class LLMError(Exception):
    pass


class RateLimited(LLMError):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class Unavailable(LLMError):
    """The model is overloaded, down or too slow right now. Another model may answer."""


class EmptyAnswer(Unavailable):
    """The model answered with nothing: no text, no tool call. In a race, another answer is better."""

    def __init__(self, reply: tuple[dict, str]):
        super().__init__("empty answer")
        self.reply = reply


THINK = re.compile(r"<think>.*?</think>", re.DOTALL)


def is_empty(msg: dict, finish: str) -> bool:
    return (not msg.get("tool_calls") and finish != "content_filter"
            and not THINK.sub("", msg.get("content") or "").strip())


def _retry_after(r) -> float | None:
    """Seconds until a rate limit lifts: the retry-after header, or Google's RetryInfo in the body."""
    try:
        if r.headers.get("retry-after"):
            return float(r.headers["retry-after"])
        body = r.json()
        for item in body if isinstance(body, list) else [body]:
            for detail in (item.get("error") or {}).get("details", []):
                if str(detail.get("retryDelay", "")).endswith("s"):
                    return float(detail["retryDelay"][:-1])
    except (ValueError, TypeError, AttributeError, KeyError):
        pass
    return None


class ChatModel:
    def __init__(self, provider: str, base_url: str, model: str, api_key: str | None,
                 extra: dict | None = None, timeout: float = 60, client: httpx.Client | None = None):
        self.provider, self.base_url, self.model = provider, base_url.rstrip("/"), model
        self.api_key, self.extra, self.timeout = api_key, extra or {}, timeout
        self.client = client  # a shared keep-alive client in a chain; None: httpx.post, as before
        self._last = threading.local()

    @property
    def last_model(self) -> str | None:
        """The model that answered this thread's last call (LLM_MODEL may list several)."""
        return getattr(self._last, "model", None)

    @classmethod
    def from_env(cls) -> "ChatModel | ModelChain":
        if os.getenv("LLM_CHAIN", "").strip():
            return ModelChain.from_env()
        provider = os.getenv("LLM_PROVIDER", "ollama")
        if provider not in PRESETS:
            raise LLMError(f"unknown LLM_PROVIDER {provider}, use one of {list(PRESETS)}")
        p = PRESETS[provider]
        key = os.getenv(p["key_env"]) if p["key_env"] else "ollama"
        if not key:
            raise LLMError(f"{provider} needs {p['key_env']}")
        return cls(provider, os.getenv("LLM_BASE_URL", p["base_url"]),
                   os.getenv("LLM_MODEL", p["model"]), key, p["extra"],
                   timeout=float(os.getenv("LLM_TIMEOUT_S", "60")))

    def complete(self, messages: list[dict], tools: list[dict], max_tokens: int | None = None) -> tuple[dict, str]:
        """One model call. Returns (assistant message, finish_reason).

        LLM_MODEL may list several models, comma separated. When one is rate limited, overloaded, down or
        too slow, the next one answers: free tiers limit each model separately. A bad request still fails.
        No tools: a plain answer. max_tokens caps the answer (thinking models get room to think on top)."""
        models = [m.strip() for m in self.model.split(",") if m.strip()] or [self.model]
        last: LLMError | None = None
        for i, model in enumerate(models):
            try:
                reply = self._complete_with(model, messages, tools, wait_on_limit=i == len(models) - 1,
                                            max_tokens=max_tokens)
                self._last.model = model
                return reply
            except (RateLimited, Unavailable) as e:
                print(f"[llm] {e}; {'trying ' + models[i + 1] if i + 1 < len(models) else 'no model left'}", flush=True)
                last = e
        raise last or RateLimited(f"{self.provider} rate limit")

    def _no_think(self, model: str) -> bool:
        return any(p in model.lower() for p in PRESETS.get(self.provider, {}).get("no_think", ()))

    def _for_provider(self, model: str, messages: list[dict]) -> list[dict]:
        """The shared history, as this provider wants it. In a chain, one turn's calls may go to
        different providers: Gemini 3 needs a signature on every tool call, others reject Gemini's."""
        gemini, no_think = self.provider == "gemini", self._no_think(model)
        last_user = max((i for i, m in enumerate(messages) if m.get("role") == "user"), default=-1)
        out = []
        for i, m in enumerate(messages):
            m = {k: v for k, v in m.items() if k != "reasoning_content"}
            if m.get("tool_calls"):
                calls = [dict(c) for c in m["tool_calls"]]
                if not gemini:
                    for c in calls:
                        c.pop("extra_content", None)
                elif not any(c.get("extra_content") for c in calls):
                    calls[0]["extra_content"] = DUMMY_SIGNATURE  # Gemini signs the first call of a step
                m["tool_calls"] = calls
            if no_think and i == last_user and isinstance(m.get("content"), str):
                m["content"] += " /no_think"
            out.append(m)
        return out

    def _complete_with(self, model: str, messages: list[dict], tools: list[dict],
                       wait_on_limit: bool = True, max_tokens: int | None = None) -> tuple[dict, str]:
        body = {"model": model, "messages": self._for_provider(model, messages), "temperature": 0.2, **self.extra}
        if tools:
            body.update(tools=tools, tool_choice="auto")
        if max_tokens:  # Qwen still thinks a little with /no_think
            thinks = "reasoning_effort" in body or self._no_think(model)
            body["max_tokens"] = max_tokens + (THINKING_TOKENS if thinks else 0)
        post = self.client.post if self.client else httpx.post
        for attempt in range(2):
            try:
                r = post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout,
                         headers={"Authorization": f"Bearer {self.api_key}"})
            except httpx.TimeoutException as e:
                raise Unavailable(f"{self.provider} {model} timed out") from e
            if r.status_code == 429:
                wait = float(r.headers.get("retry-after", "0") or 0)
                # Free tiers: one short retry, then give up. Not when another model can answer at once.
                if wait_on_limit and attempt == 0 and wait <= 5:
                    time.sleep(wait or 1)
                    continue
                raise RateLimited(f"{self.provider} {model} rate limit, retry after {wait or '?'} s",
                                  _retry_after(r))
            if r.status_code >= 500:
                raise Unavailable(f"{self.provider} {model} {r.status_code}: {r.text[:300]}")
            if r.status_code >= 400:
                raise LLMError(f"{self.provider} {r.status_code}: {r.text[:300]}")
            choice = r.json()["choices"][0]
            msg = choice["message"]
            # Keep only the standard fields; some providers add extras they reject when echoed back
            # (Qwen's reasoning_content, for one). Except extra_content on a tool call: Gemini 3 puts
            # its "thought signature" there and refuses the next step if it is not sent back.
            clean = {"role": "assistant", "content": msg.get("content") or ""}
            if msg.get("tool_calls"):
                clean["tool_calls"] = [
                    {"id": c["id"], "type": "function",
                     "function": {"name": c["function"]["name"],
                                  "arguments": c["function"].get("arguments") or "{}"},
                     **({"extra_content": c["extra_content"]} if c.get("extra_content") else {})}
                    for c in msg["tool_calls"]]
            else:
                known = {t["function"]["name"] for t in tools or []}
                content, calls = tool_calls_in_text(clean["content"], known)
                if calls:
                    clean = {"role": "assistant", "content": content, "tool_calls": calls}
            return clean, choice.get("finish_reason") or "stop"
        raise RateLimited(f"{self.provider} {model} rate limit")


# ---------- several providers, raced ----------

POOL = ThreadPoolExecutor(max_workers=16, thread_name_prefix="llm")
MAX_COOLDOWN_S = 3600  # a daily quota says "come back in 23 h": look again in an hour
GRACE_S = 1.0          # httpx times each step out separately; past timeout + this, an attempt counts as lost


def _extra_for(preset: dict, model: str) -> dict:
    extra = dict(preset["extra"])
    prefixes = preset.get("reasoning_models")
    if prefixes and not model.startswith(prefixes):
        extra.pop("reasoning_effort", None)
    return extra


class ModelChain:
    """LLM_CHAIN: several provider:model entries, raced.

    The first ready entry starts. If it hasn't answered after LLM_HEDGE_MS, the next one starts too,
    and the first good answer wins; a late one is ignored. An error (429, 5xx, timeout, no connection,
    a bad request) starts the next entry at once. An entry that hit a rate limit, an outage or a timeout
    cools down for LLM_COOLDOWN_S, or longer when the provider says when to come back. Cooling entries
    only run when nothing else is left, so the turn still gets an answer if one can."""
    provider = "chain"

    def __init__(self, entries: list[ChatModel], hedge_s: float = 2.0, cooldown_s: float = 60.0,
                 timeout_s: float = 6.0, clock=time.monotonic):
        if not entries:
            raise LLMError("LLM_CHAIN has no usable entry")
        self.entries, self.hedge_s, self.cooldown_s, self.timeout_s = entries, hedge_s, cooldown_s, timeout_s
        self.clock = clock  # for cooldowns; hedging and deadlines use real time
        self.model = ",".join(self.name(i) for i in range(len(entries)))
        self._cool: dict[int, float] = {}
        self._lock = threading.Lock()
        self._last = threading.local()

    @classmethod
    def from_env(cls) -> "ModelChain":
        timeout = float(os.getenv("LLM_TIMEOUT_S", "6"))
        client = httpx.Client(timeout=timeout, limits=httpx.Limits(max_keepalive_connections=8, keepalive_expiry=60))
        entries = []
        for item in os.getenv("LLM_CHAIN", "").split(","):
            provider, _, model = item.strip().partition(":")  # the first colon only
            provider, model = provider.strip().lower(), model.strip()
            if not provider:
                continue
            p = PRESETS.get(provider)
            if p is None:
                print(f"[llm] LLM_CHAIN: no provider called {provider!r}, skipping {item.strip()!r}", flush=True)
                continue
            key = os.getenv(p["key_env"]) if p["key_env"] else "ollama"
            if not key:
                print(f"[llm] LLM_CHAIN: {p['key_env']} is not set, skipping {item.strip()!r}", flush=True)
                continue
            model = model or p["model"]
            entries.append(ChatModel(provider, p["base_url"], model, key, _extra_for(p, model), timeout, client))
        if not entries:
            raise LLMError("LLM_CHAIN has no usable entry (unknown providers or missing keys)")
        return cls(entries, hedge_s=float(os.getenv("LLM_HEDGE_MS", "2000")) / 1000,
                   cooldown_s=float(os.getenv("LLM_COOLDOWN_S", "60")), timeout_s=timeout)

    def name(self, i: int) -> str:
        return f"{self.entries[i].provider}:{self.entries[i].model}"

    @property
    def last_model(self) -> str | None:
        return getattr(self._last, "model", None)

    @property
    def last_provider(self) -> str | None:
        return getattr(self._last, "provider", None)

    def cooling(self) -> dict[str, float]:
        """Entries cooling down, with seconds left. For /health and tests."""
        now = self.clock()
        with self._lock:
            return {self.name(i): round(t - now, 1) for i, t in self._cool.items() if t > now}

    def _cool_down(self, i: int, seconds: float) -> None:
        with self._lock:
            self._cool[i] = max(self._cool.get(i, 0.0), self.clock() + seconds)

    def _attempt(self, i: int, messages, tools, max_tokens):
        """One entry, one call, in a pool thread. Records a cooldown even if the race is already over."""
        entry = self.entries[i]
        try:
            reply = entry._complete_with(entry.model, messages, tools, wait_on_limit=False, max_tokens=max_tokens)
            if is_empty(*reply):
                raise EmptyAnswer(reply)  # not an outage: no cooldown
            return reply
        except RateLimited as e:
            self._cool_down(i, max(self.cooldown_s, min(e.retry_after or 0, MAX_COOLDOWN_S)))
            raise
        except EmptyAnswer:
            raise
        except Unavailable:
            self._cool_down(i, self.cooldown_s)
            raise
        except httpx.TransportError as e:  # no connection, reset, ...
            self._cool_down(i, self.cooldown_s)
            raise Unavailable(f"{self.name(i)} {type(e).__name__}") from e

    def complete(self, messages: list[dict], tools: list[dict], max_tokens: int | None = None) -> tuple[dict, str]:
        now = self.clock()
        with self._lock:
            ready = [i for i in range(len(self.entries)) if self._cool.get(i, 0.0) <= now]
        cooling = sorted((i for i in range(len(self.entries)) if i not in ready), key=lambda i: self._cool[i])
        if not ready:  # everything is cooling down: try them anyway, soonest back first
            ready, cooling = cooling, []
        pending: dict = {}
        errors: list[Exception] = []
        empty = None  # an empty answer: given back only if nothing better comes

        def start(i: int) -> None:
            pending[POOL.submit(self._attempt, i, messages, tools, max_tokens)] = (i, time.monotonic())

        start(ready.pop(0))
        hedge_at = time.monotonic() + self.hedge_s
        while pending:
            deadline = min(t0 for _, t0 in pending.values()) + self.timeout_s + GRACE_S
            until = min(deadline, hedge_at) if ready else deadline
            done, _ = wait(list(pending), timeout=max(0.0, until - time.monotonic()), return_when=FIRST_COMPLETED)
            failed = 0
            for fut in done:
                i, _ = pending.pop(fut)
                try:
                    reply = fut.result()
                except EmptyAnswer as e:
                    print(f"[llm] {self.name(i)}: empty answer, waiting for another", flush=True)
                    empty = empty or (i, e.reply)
                    failed += 1
                    continue
                except Exception as e:  # noqa: BLE001  any failure: the next entry may answer
                    print(f"[llm] {self.name(i)}: {e}", flush=True)
                    errors.append(e)
                    failed += 1
                    continue
                self._last.model, self._last.provider = self.entries[i].model, self.entries[i].provider
                return reply
            now = time.monotonic()
            for fut, (i, t0) in list(pending.items()):
                if now >= t0 + self.timeout_s + GRACE_S:  # still nothing: count it as timed out
                    del pending[fut]
                    self._cool_down(i, self.cooldown_s)
                    errors.append(Unavailable(f"{self.name(i)} timed out"))
                    failed += 1
            hedge = bool(ready) and now >= hedge_at
            for _ in range(failed + hedge):
                if ready:
                    start(ready.pop(0))
            if not pending and cooling and empty is None:  # last resort: one that was cooling down
                start(cooling.pop(0))
            if failed or hedge:
                hedge_at = time.monotonic() + self.hedge_s
        if empty:
            i, reply = empty
            self._last.model, self._last.provider = self.entries[i].model, self.entries[i].provider
            return reply
        if errors and all(isinstance(e, RateLimited) for e in errors):
            raise RateLimited("every model in LLM_CHAIN is rate limited")
        last = errors[-1] if errors else None
        raise last if isinstance(last, LLMError) else Unavailable(f"no model in LLM_CHAIN answered: {last}")


TEXT_CALL_BLOCK = re.compile(r"<(tools|tool_call)>(.*?)</\1>", re.DOTALL)
TAG_CALL = re.compile(r"<(\w+)((?:\s+\w+=\"[^\"]*\")*)\s*/>")                 # <show_asset asset_id="XAU"/>
TAG_ATTR = re.compile(r"(\w+)=\"([^\"]*)\"")
QWEN_CALL = re.compile(r"<function=(\w+)>(.*?)</function>", re.DOTALL)        # Qwen's own format
QWEN_PARAM = re.compile(r"<parameter=(\w+)>\s*(.*?)\s*</parameter>", re.DOTALL)


def _typed(value: str):
    """Text from a tag attribute to the JSON type the tool expects."""
    if value in ("true", "false"):
        return value == "true"
    try:
        return json.loads(value) if value[:1] in "[{" else float(value) if "." in value else int(value)
    except ValueError:
        return value


def _tag_calls(content: str, known: set[str]) -> list[dict]:
    found = [(m.group(1), dict(TAG_ATTR.findall(m.group(2)))) for m in TAG_CALL.finditer(content)]
    found += [(m.group(1), dict(QWEN_PARAM.findall(m.group(2)))) for m in QWEN_CALL.finditer(content)]
    return [{"id": "", "type": "function",
             "function": {"name": name, "arguments": json.dumps({k: _typed(v) for k, v in args.items()})}}
            for name, args in found if name in known]


def _json_calls(body: str, known: set[str]) -> list[dict]:
    """Every {"name": <known tool>, "arguments": {...}} object inside some text."""
    calls, pos, decoder = [], 0, json.JSONDecoder()
    while (start := body.find("{", pos)) != -1:
        try:
            obj, pos = decoder.raw_decode(body, start)
        except json.JSONDecodeError:
            pos = start + 1
            continue
        if isinstance(obj, dict) and obj.get("name") in known:
            calls.append({"id": f"text_call_{len(calls)}", "type": "function",
                          "function": {"name": obj["name"],
                                       "arguments": json.dumps(obj.get("arguments", {}))}})
    return calls


def tool_calls_in_text(content: str, known: set[str]) -> tuple[str, list[dict]]:
    """Some local models write tool calls as text instead of making them:
    <tools>{"name": .., "arguments": {..}}</tools>, or just the bare JSON.
    Turn calls to tools we offered into real calls. Returns (leftover text, calls)."""
    calls = []
    for block in TEXT_CALL_BLOCK.finditer(content):
        calls += _json_calls(block.group(2), known)
    content = TEXT_CALL_BLOCK.sub("", content)
    if not calls:
        calls = _json_calls(content, known) or _tag_calls(content, known)
        if calls:  # the whole reply was the call; drop it so it isn't shown or spoken
            content = ""
    for i, call in enumerate(calls):
        call["id"] = f"text_call_{i}"
    return content.strip(), calls


def parse_arguments(raw: str) -> dict:
    args = json.loads(raw or "{}")
    if not isinstance(args, dict):
        raise ValueError("tool arguments must be a JSON object")
    return args
