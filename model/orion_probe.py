"""Standalone Orion capability probe. Uses Python's standard library only."""

import argparse
import json
import os
from pathlib import Path
import time
import urllib.error
import urllib.request


def load_local_env(path):
    """Read simple KEY=value settings; never execute or interpolate file contents."""
    if not path.exists():
        return
    allowed = {"ICARUS_LLM_BASE_URL", "ICARUS_LLM_MODEL", "ICARUS_LLM_API_KEY"}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or key not in allowed:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        os.environ.setdefault(key, value)


load_local_env(Path(__file__).resolve().with_name(".env"))
BASE_URL = os.getenv("ICARUS_LLM_BASE_URL", "https://api.orion.cmkl.ai/v1").rstrip("/")


def request(path, payload=None):
    key = os.getenv("ICARUS_LLM_API_KEY")
    if not key:
        raise RuntimeError("Set ICARUS_LLM_API_KEY locally before running live probes.")
    if not BASE_URL.startswith("https://"):
        raise RuntimeError("Use an HTTPS gateway URL.")
    req = urllib.request.Request(
        BASE_URL + path,
        data=None if payload is None else json.dumps(payload).encode("utf-8"),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
        method="GET" if payload is None else "POST",
    )
    started = time.perf_counter()
    # Do not forward credentials to a redirected endpoint.
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            return None

    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=90) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(
            f"Gateway HTTP {exc.code}. Check model ID, feature support, key, quota, and status. "
            "Response body omitted to avoid exposing sensitive diagnostics."
        ) from None
    except urllib.error.URLError:
        raise RuntimeError("Gateway connection failed; check network and gateway availability.") from None
    except (TimeoutError, json.JSONDecodeError):
        raise RuntimeError("Gateway timed out or returned invalid JSON.") from None
    return result, round(time.perf_counter() - started, 3)


def chat(model, messages, **options):
    result, elapsed = request("/chat/completions", {
        "model": model, "messages": messages, "max_tokens": 1536,
        **options,
    })
    try:
        message = result["choices"][0]["message"]
    except (KeyError, IndexError, TypeError):
        raise RuntimeError("Unexpected completion envelope; inspect gateway compatibility.") from None
    print(json.dumps({"elapsed_seconds": elapsed, "usage": result.get("usage"),
                      "finish_reason": result["choices"][0].get("finish_reason")}, ensure_ascii=False))
    if result["choices"][0].get("finish_reason") == "length":
        raise RuntimeError("Response reached the token limit; incomplete output is not a passing result.")
    if not message.get("tool_calls") and not (message.get("content") or "").strip():
        raise RuntimeError("Model returned no user-visible answer.")
    return message


PROMPTS = {
    "en": {
        "basic": "In one sentence, explain the difference between a crypto wallet and an exchange.",
        "numbers": "Explain this synthetic purchase preview in one sentence: total budget 1000 THB; fee 5 THB; asset purchase amount 995 THB. Copy values exactly. This is a simulation, not a live quote. Do not add market facts.",
        "json": 'Return JSON only: {"intent":"explain_fee","needs_tool":false}. Keep these machine-readable values unchanged.',
        "tools": "Call get_demo_preview for asset_id gold, then explain its returned budget, fee, and purchase amount. Do not invent a preview or execute anything.",
    },
    "th": {
        "basic": "อธิบายความแตกต่างระหว่างกระเป๋าคริปโตกับแพลตฟอร์มซื้อขายคริปโตในหนึ่งประโยค",
        "numbers": "อธิบายตัวอย่างรายการซื้อจำลองนี้ในหนึ่งประโยค: งบรวม 1000 บาท ค่าธรรมเนียม 5 บาท จำนวนเงินที่ใช้ซื้อสินทรัพย์ 995 บาท ใช้ตัวเลขตามที่ให้ทุกค่า นี่เป็นการจำลอง ไม่ใช่ราคาเสนอซื้อขายจริง ห้ามเพิ่มข้อมูลตลาด",
        "json": 'ตอบเป็น JSON เท่านั้น: {"intent":"explain_fee","needs_tool":false} คงชื่อฟิลด์และค่าเหล่านี้ไว้เพื่อให้โปรแกรมอ่านได้',
        "tools": "เรียก get_demo_preview โดยใช้ asset_id เป็น gold แล้วอธิบายงบรวม ค่าธรรมเนียม และจำนวนเงินที่ใช้ซื้อจากผลลัพธ์ ห้ามแต่งข้อมูลรายการซื้อหรือดำเนินการซื้อขาย",
    },
}


def run_probe(model, probe, language):
    print(json.dumps({"probe": probe, "language": language}))
    instruction = (
        "Answer in plain English in at most three short sentences, without headings or tables. Preserve tool names, IDs, JSON keys, units, and numeric meaning."
        if language == "en" else
        "ตอบเป็นภาษาไทยที่เข้าใจง่าย ไม่เกินสามประโยคสั้น ๆ ไม่ใช้หัวข้อหรือตาราง คงชื่อเครื่องมือ รหัส และชื่อฟิลด์ JSON ไว้ ห้ามเปลี่ยนความหมายของตัวเลขหรือหน่วย"
    )
    messages = [{"role": "system", "content": instruction},
                {"role": "user", "content": PROMPTS[language][probe]}]
    if probe != "tools":
        options = {"response_format": {"type": "json_object"}} if probe == "json" else {}
        message = chat(model, messages, **options)
        content = message.get("content")
        print(content)
        if probe == "json":
            parsed = json.loads(content)
            if parsed != {"intent": "explain_fee", "needs_tool": False}:
                raise RuntimeError("Returned JSON did not match expected values.")
        return

    tools = [{"type": "function", "function": {
        "name": "get_demo_preview", "description": "Read a synthetic purchase preview. Does not execute trades.",
        "parameters": {"type": "object", "properties": {"asset_id": {"type": "string", "enum": ["gold"]}},
                       "required": ["asset_id"], "additionalProperties": False},
    }}]
    first = chat(model, messages, tools=tools, tool_choice="auto")
    calls = first.get("tool_calls") or []
    if len(calls) != 1:
        raise RuntimeError("Expected one structured tool call. Automatic tool selection was not demonstrated.")
    call = calls[0]
    if call["function"]["name"] != "get_demo_preview" or json.loads(call["function"]["arguments"]) != {"asset_id": "gold"}:
        raise RuntimeError("Tool name or arguments failed validation; no tool was executed.")
    messages.append({"role": "assistant", "content": first.get("content"), "tool_calls": calls})
    messages.append({"role": "tool", "tool_call_id": call["id"], "content": json.dumps({
        "result_id": "fixture_preview_1", "origin": "synthetic", "currency": "THB",
        "budget": "1000.00", "fee": "5.00", "purchase_amount": "995.00",
    })})
    final = chat(model, messages, tools=tools, tool_choice="none")
    if final.get("tool_calls"):
        raise RuntimeError("Unexpected further tool call; final-answer behavior was not demonstrated.")
    print(final.get("content"))
    print("Tool cycle completed. Human review of financial meaning and numerical fidelity is still required.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default=os.getenv("ICARUS_LLM_MODEL"))
    parser.add_argument("--probe", choices=["models", "basic", "thai", "numbers", "json", "tools", "all"],
                        default="basic")
    parser.add_argument("--lang", choices=["en", "th", "both"], default="both")
    args = parser.parse_args()
    if args.probe == "models":
        result, elapsed = request("/models")
        print(json.dumps({"elapsed_seconds": elapsed,
                          "models": [entry.get("id") for entry in result.get("data", [])]}, indent=2))
        return
    if not args.model:
        parser.error("Provide --model with the exact gateway ID or set ICARUS_LLM_MODEL.")

    languages = ["en", "th"] if args.lang == "both" else [args.lang]
    probes = ["basic", "numbers", "tools", "json"] if args.probe == "all" else [args.probe]
    if args.probe == "thai":
        languages, probes = ["th"], ["basic"]
    failures = []
    for probe in probes:
        for language in languages:
            try:
                run_probe(args.model, probe, language)
            except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                failures.append({"probe": probe, "language": language, "error": str(exc)})
                print(json.dumps(failures[-1], ensure_ascii=False))
    if failures:
        raise RuntimeError(f"{len(failures)} probe(s) failed. See labeled errors above.")


if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    try:
        main()
    except (RuntimeError, ValueError, KeyError, TypeError) as exc:
        raise SystemExit(str(exc)) from None
