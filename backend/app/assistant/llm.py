"""Talk to any LLM that speaks the OpenAI chat-completions format.

That covers the free options: Groq, Google Gemini, and Ollama on a laptop.
Pick with env vars:
  LLM_PROVIDER = ollama (default) | groq | gemini
  LLM_MODEL    = override the preset's model
  LLM_BASE_URL = override the preset's URL
"""
import json
import os
import re
import time

import httpx

import app.config  # noqa: F401  loads backend/.env before we read keys

PRESETS = {
    "groq": {"base_url": "https://api.groq.com/openai/v1", "key_env": "GROQ_API_KEY",
             "model": "openai/gpt-oss-120b", "extra": {"reasoning_effort": "low"}},
    "gemini": {"base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
               "key_env": "GEMINI_API_KEY", "model": "gemini-flash-latest",
               "extra": {"reasoning_effort": "low"}},
    "ollama": {"base_url": "http://localhost:11434/v1", "key_env": None,
               "model": "icarus", "extra": {"keep_alive": "2h"}},
}


class LLMError(Exception):
    pass


class RateLimited(LLMError):
    pass


class Unavailable(LLMError):
    """The model is overloaded, down or too slow right now. Another model may answer."""


class ChatModel:
    def __init__(self, provider: str, base_url: str, model: str, api_key: str | None,
                 extra: dict | None = None, timeout: float = 60):
        self.provider, self.base_url, self.model = provider, base_url.rstrip("/"), model
        self.api_key, self.extra, self.timeout = api_key, extra or {}, timeout

    @classmethod
    def from_env(cls) -> "ChatModel":
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

    def complete(self, messages: list[dict], tools: list[dict]) -> tuple[dict, str]:
        """One model call. Returns (assistant message, finish_reason).

        LLM_MODEL may list several models, comma separated. When one is rate limited, overloaded, down or
        too slow, the next one answers: free tiers limit each model separately. A bad request still fails."""
        models = [m.strip() for m in self.model.split(",") if m.strip()] or [self.model]
        last: LLMError | None = None
        for i, model in enumerate(models):
            try:
                reply = self._complete_with(model, messages, tools, wait_on_limit=i == len(models) - 1)
                self.last_model = model
                return reply
            except (RateLimited, Unavailable) as e:
                print(f"[llm] {e}; {'trying ' + models[i + 1] if i + 1 < len(models) else 'no model left'}", flush=True)
                last = e
        raise last or RateLimited(f"{self.provider} rate limit")

    def _complete_with(self, model: str, messages: list[dict], tools: list[dict],
                       wait_on_limit: bool = True) -> tuple[dict, str]:
        body = {"model": model, "messages": messages, "tools": tools,
                "tool_choice": "auto", "temperature": 0.2, **self.extra}
        for attempt in range(2):
            try:
                r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout,
                               headers={"Authorization": f"Bearer {self.api_key}"})
            except httpx.TimeoutException as e:
                raise Unavailable(f"{self.provider} {model} timed out") from e
            if r.status_code == 429:
                wait = float(r.headers.get("retry-after", "0") or 0)
                # Free tiers: one short retry, then give up. Not when another model can answer at once.
                if wait_on_limit and attempt == 0 and wait <= 5:
                    time.sleep(wait or 1)
                    continue
                raise RateLimited(f"{self.provider} {model} rate limit, retry after {wait or '?'} s")
            if r.status_code >= 500:
                raise Unavailable(f"{self.provider} {model} {r.status_code}: {r.text[:300]}")
            if r.status_code >= 400:
                raise LLMError(f"{self.provider} {r.status_code}: {r.text[:300]}")
            choice = r.json()["choices"][0]
            msg = choice["message"]
            # Keep only the standard fields; some providers add extras they reject when echoed back.
            # Except extra_content on a tool call: Gemini 3 puts its "thought signature" there and refuses
            # the next step if it is not sent back. Only a provider that sent it gets it back.
            clean = {"role": "assistant", "content": msg.get("content") or ""}
            if msg.get("tool_calls"):
                clean["tool_calls"] = [
                    {"id": c["id"], "type": "function",
                     "function": {"name": c["function"]["name"],
                                  "arguments": c["function"].get("arguments") or "{}"},
                     **({"extra_content": c["extra_content"]} if c.get("extra_content") else {})}
                    for c in msg["tool_calls"]]
            else:
                known = {t["function"]["name"] for t in tools}
                content, calls = tool_calls_in_text(clean["content"], known)
                if calls:
                    clean = {"role": "assistant", "content": content, "tool_calls": calls}
            return clean, choice.get("finish_reason") or "stop"
        raise RateLimited(f"{self.provider} {model} rate limit")


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
        except (json.JSONDecodeError, RecursionError):  # garbage, or JSON nested too deep to read
            pos = start + 1
            continue
        if isinstance(obj, dict) and isinstance(obj.get("name"), str) and obj["name"] in known:
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
    # A bare call is the whole reply. JSON quoted inside a normal sentence is just text, not a call to run.
    if not calls and content.lstrip()[:1] in ("{", "<", "`", "["):
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
