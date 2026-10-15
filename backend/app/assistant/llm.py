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
                   os.getenv("LLM_MODEL", p["model"]), key, p["extra"])

    def complete(self, messages: list[dict], tools: list[dict]) -> tuple[dict, str]:
        """One model call. Returns (assistant message, finish_reason)."""
        body = {"model": self.model, "messages": messages, "tools": tools,
                "tool_choice": "auto", "temperature": 0.2, **self.extra}
        for attempt in range(2):
            r = httpx.post(f"{self.base_url}/chat/completions", json=body, timeout=self.timeout,
                           headers={"Authorization": f"Bearer {self.api_key}"})
            if r.status_code == 429:
                wait = float(r.headers.get("retry-after", "0") or 0)
                if attempt == 0 and wait <= 5:  # free tiers: one short retry, then give up
                    time.sleep(wait or 1)
                    continue
                raise RateLimited(f"{self.provider} rate limit, retry after {wait or '?'} s")
            if r.status_code >= 400:
                raise LLMError(f"{self.provider} {r.status_code}: {r.text[:300]}")
            choice = r.json()["choices"][0]
            msg = choice["message"]
            # Keep only the standard fields; some providers add extras they reject when echoed back.
            clean = {"role": "assistant", "content": msg.get("content") or ""}
            if msg.get("tool_calls"):
                clean["tool_calls"] = [
                    {"id": c["id"], "type": "function",
                     "function": {"name": c["function"]["name"],
                                  "arguments": c["function"].get("arguments") or "{}"}}
                    for c in msg["tool_calls"]]
            else:
                content, calls = tool_calls_in_text(clean["content"])
                if calls:
                    clean = {"role": "assistant", "content": content, "tool_calls": calls}
            return clean, choice.get("finish_reason") or "stop"
        raise RateLimited(f"{self.provider} rate limit")


TEXT_CALL_BLOCK = re.compile(r"<(tools|tool_call)>(.*?)</\1>", re.DOTALL)


def tool_calls_in_text(content: str) -> tuple[str, list[dict]]:
    """Some local models write tool calls as text: <tools>{"name": .., "arguments": {..}}</tools>.
    Turn those into real tool calls. Returns (content without the blocks, calls)."""
    calls = []
    for block in TEXT_CALL_BLOCK.finditer(content):
        body, pos, decoder = block.group(2), 0, json.JSONDecoder()
        while (start := body.find("{", pos)) != -1:
            try:
                obj, pos = decoder.raw_decode(body, start)
            except json.JSONDecodeError:
                break
            if isinstance(obj, dict) and "name" in obj:
                calls.append({"id": f"text_call_{len(calls)}", "type": "function",
                              "function": {"name": obj["name"],
                                           "arguments": json.dumps(obj.get("arguments", {}))}})
    return TEXT_CALL_BLOCK.sub("", content).strip(), calls


def parse_arguments(raw: str) -> dict:
    args = json.loads(raw or "{}")
    if not isinstance(args, dict):
        raise ValueError("tool arguments must be a JSON object")
    return args
