"""Repeat bilingual numerical/tool probes and compare a candidate no-thinking flag."""
import argparse
import contextlib
import io
import json
from pathlib import Path
import statistics
import time

import orion_probe as probe


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repeats", type=int, default=2)
    parser.add_argument("--model", default="Qwen 3.8-27B-NVFP4")
    args = parser.parse_args()
    if not 1 <= args.repeats <= 5:
        parser.error("Use 1 to 5 repeats.")
    original_request = probe.request
    records = []
    rejected_modes = set()
    # Alternate mode order across repeats to reduce simple ordering effects.
    for repeat in range(args.repeats):
        modes = ["default", "no_thinking_candidate"]
        if repeat % 2:
            modes.reverse()
        for language in ["en", "th"]:
            for task in ["numbers", "tools"]:
                for mode in modes:
                    if mode in rejected_modes:
                        continue
                    calls = []

                    def measured_request(path, payload=None):
                        if payload is not None and mode != "default":
                            payload = {**payload, "chat_template_kwargs": {"enable_thinking": False}}
                        result, elapsed = original_request(path, payload)
                        calls.append({"seconds": elapsed, "usage": result.get("usage"),
                                      "finish_reason": result.get("choices", [{}])[0].get("finish_reason")})
                        return result, elapsed

                    probe.request = measured_request
                    output = io.StringIO()
                    start = time.perf_counter()
                    record = {"repeat": repeat + 1, "language": language, "task": task, "mode": mode}
                    try:
                        with contextlib.redirect_stdout(output):
                            probe.run_probe(args.model, task, language)
                        record["status"] = "completed"
                    except (RuntimeError, ValueError, KeyError, TypeError) as exc:
                        record.update(status="failed", error=str(exc))
                        if mode != "default":
                            rejected_modes.add(mode)
                    finally:
                        probe.request = original_request
                    record.update(seconds=round(time.perf_counter() - start, 3), calls=calls,
                                  output=output.getvalue())
                    records.append(record)
                    print(json.dumps({key: value for key, value in record.items() if key != "output"}), flush=True)

    summaries = []
    for language in ["en", "th"]:
        for task in ["numbers", "tools"]:
            for mode in ["default", "no_thinking_candidate"]:
                matched = [r for r in records if (r["language"], r["task"], r["mode"]) == (language, task, mode)]
                values = [r["seconds"] for r in matched if r["status"] == "completed"]
                summaries.append({"language": language, "task": task, "mode": mode,
                                  "completed": len(values), "attempted": len(matched),
                                  "median_seconds": round(statistics.median(values), 3) if values else None,
                                  "min_seconds": min(values) if values else None,
                                  "max_seconds": max(values) if values else None})
    target = Path(__file__).with_name("results") / "latency_benchmark.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({"model": args.model, "records": records, "summary": summaries},
                                 ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"summary": summaries, "saved_to": str(target)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
