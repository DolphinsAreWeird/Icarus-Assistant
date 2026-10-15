"""Run a curated demo suite; structural checks do not replace financial/Thai review."""
import argparse
from datetime import datetime,timezone
import json
import statistics
from icarus_core import ROOT,read_json
from session import ConversationSession


def structural_checks(case, result, *, live):
    tool_names = [source["data"].get("tool") for source in result["sources"]]
    source_ids = {source["id"] for source in result["sources"]}
    checks = {"expected_status": result["status"] == case.get("expected_status", "ok"),
              "no_execution_actions": result["ui_actions"] == []}
    if "expected_tool" in case:
        checks["expected_tool"] = case["expected_tool"] in tool_names if live else None
    if "expected_sources" in case:
        expected = set(case["expected_sources"])
        checks["expected_sources"] = expected.issubset(source_ids) if case.get("all_sources") else bool(expected & source_ids)
    if "expected_route" in case:
        checks["expected_route"] = result["route"] == case["expected_route"]
    if "expected_profile" in case:
        checks["expected_profile"] = all(result["profile_context"].get(k) == v for k, v in case["expected_profile"].items())
    if case.get("no_tools"):
        checks["no_tools"] = not result["tool_results"] if live else None
    if case.get("no_model_calls"):
        checks["no_model_calls"] = not result["model_calls"] if live else None
    return checks


def latency_summary(results):
    groups = {}
    for row in results:
        for result in row.get("turn_results", [row["result"]]):
            key = "model" if result["model_calls"] else (
                "failed_or_rejected" if result.get("status") == "needs_review" else "local")
            groups.setdefault(key, []).append(result["elapsed_seconds"])
    return {name: {"turns": len(values), "median_seconds": statistics.median(values),
                   "max_seconds": max(values)} for name, values in groups.items()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live",action="store_true",help="Make quota-consuming Orion requests")
    parser.add_argument("--limit",type=int,default=4)
    parser.add_argument("--ids",nargs="*")
    parser.add_argument("--snapshot",help="Optional app snapshot for current-price/displayed-chart scenarios")
    parser.add_argument("--suite", choices=["demo", "stress"], default="demo")
    args = parser.parse_args()
    adapter,screen_context = None,None
    if args.snapshot:
        from data_adapter import SnapshotAdapter
        adapter = SnapshotAdapter.from_file(args.snapshot)
        screen_context = adapter.screen_context()
    cases = read_json(ROOT / "evaluation" / ("cases.json" if args.suite == "demo" else "stress_cases.json"))
    if args.ids:
        unknown = set(args.ids)-{case["id"] for case in cases}
        if unknown:
            parser.error("Unknown case IDs")
        cases = [case for case in cases if case["id"] in args.ids]
    else:
        if args.limit < 1:
            parser.error("Limit must be positive")
        cases = cases[:args.limit]
    results = []
    for case in cases:
        session = ConversationSession(profile_id=case["profile"], language=case["lang"])
        turns = [session.ask(message, offline=not args.live, data_adapter=adapter, screen_context=screen_context)
                 for message in case.get("turns", [case.get("message", "")])]
        result = turns[-1]
        checks = structural_checks(case, result, live=args.live)
        row = {"case":case,"checks":checks,"result":result,"turn_results":turns,"human_review":"pending",
               "semantic_quality":"unscored"}
        results.append(row)
        print(json.dumps({"id":case["id"],"checks":checks,"seconds":result["elapsed_seconds"],
                          "text":result["text"],"limitations":result["limitations"]},ensure_ascii=False),flush=True)
    name = "assistant" if args.suite == "demo" else "assistant_stress"
    target = ROOT / "results" / (name + ("_live.json" if args.live else "_offline.json"))
    target.parent.mkdir(exist_ok=True)
    run_at = datetime.now(timezone.utc)
    summary = latency_summary(results)
    print(json.dumps({"latency_summary": summary}), flush=True)
    content = json.dumps({"run_at":run_at.isoformat(),"live":args.live,"suite":args.suite,
                          "latency_summary":summary,"results":results},ensure_ascii=False,indent=2)
    target.write_text(content,encoding="utf-8")
    target.with_name(target.stem + "_" + run_at.strftime("%Y%m%dT%H%M%S%fZ") + ".json").write_text(content,encoding="utf-8")
    if any(any(value is False for value in row["checks"].values()) for row in results):
        raise SystemExit("Some structural checks failed; inspect saved results. Human review remains required.")


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    main()
