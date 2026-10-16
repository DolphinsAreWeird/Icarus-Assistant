"""Small gateway feature probe; accepted fields may still be ignored by the model."""
import json
from orion_probe import request,PROMPTS
from icarus_core import ROOT


def main():
    import os
    model = os.getenv("ICARUS_LLM_MODEL")
    if not model:
        raise SystemExit("Model ID is not configured")
    results = []
    candidates = [
        ("enable_thinking_false",{"enable_thinking":False}),
        ("reasoning_effort_none",{"reasoning_effort":"none"}),
        ("reasoning_effort_low",{"reasoning_effort":"low"}),
    ]
    for name,option in candidates:
        row = {"candidate":name}
        try:
            response,elapsed = request("/chat/completions",{
                "model":model,"max_tokens":1536,
                "messages":[{"role":"system","content":"ตอบเป็นภาษาไทยสั้น ๆ ไม่เกินหนึ่งประโยค"},
                            {"role":"user","content":PROMPTS["th"]["numbers"]}],**option})
            choice = response["choices"][0]
            row.update(status="accepted",seconds=elapsed,usage=response.get("usage"),
                       finish_reason=choice.get("finish_reason"),text=choice["message"].get("content"))
        except (RuntimeError,KeyError,TypeError) as exc:
            row.update(status="failed",error=str(exc))
        results.append(row)
        print(json.dumps(row,ensure_ascii=False),flush=True)
    path = ROOT/"results"/"reasoning_options.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    main()
