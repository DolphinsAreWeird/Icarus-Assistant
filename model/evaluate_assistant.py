"""Run a curated demo suite; structural checks do not replace financial/Thai review."""
import argparse
from datetime import datetime,timezone
import json
from icarus_core import ROOT,read_json
from assistant import answer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live",action="store_true",help="Make quota-consuming Orion requests")
    parser.add_argument("--limit",type=int,default=4)
    parser.add_argument("--ids",nargs="*")
    parser.add_argument("--snapshot",help="Optional app snapshot for current-price/displayed-chart scenarios")
    args = parser.parse_args()
    adapter,screen_context = None,None
    if args.snapshot:
        from data_adapter import SnapshotAdapter
        adapter = SnapshotAdapter.from_file(args.snapshot)
        screen_context = adapter.screen_context()
    cases = read_json(ROOT / "evaluation" / "cases.json")
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
        result = answer(case["message"],language=case["lang"],profile_id=case["profile"],offline=not args.live,
                        data_adapter=adapter,screen_context=screen_context)
        tool_names = [source["data"].get("tool") for source in result["sources"]]
        source_ids = [source["id"] for source in result["sources"]]
        checks = {"complete_answer":result["status"]=="ok", "no_execution_actions":result["ui_actions"]==[]}
        if "expected_tool" in case:
            checks["expected_tool"] = case["expected_tool"] in tool_names if args.live else None
        if "expected_sources" in case:
            checks["expected_sources"] = any(source in source_ids for source in case["expected_sources"])
        if "expected_route" in case:
            checks["expected_route"] = result["route"]==case["expected_route"]
        row = {"case":case,"checks":checks,"result":result,"human_review":"pending"}
        results.append(row)
        print(json.dumps({"id":case["id"],"checks":checks,"seconds":result["elapsed_seconds"],
                          "text":result["text"],"limitations":result["limitations"]},ensure_ascii=False),flush=True)
    target = ROOT / "results" / ("assistant_live.json" if args.live else "assistant_offline.json")
    target.parent.mkdir(exist_ok=True)
    run_at = datetime.now(timezone.utc)
    content = json.dumps({"run_at":run_at.isoformat(),"live":args.live,"results":results},ensure_ascii=False,indent=2)
    target.write_text(content,encoding="utf-8")
    target.with_name(target.stem + "_" + run_at.strftime("%Y%m%dT%H%M%S%fZ") + ".json").write_text(content,encoding="utf-8")
    if any(any(value is False for value in row["checks"].values()) for row in results):
        raise SystemExit("Some structural checks failed; inspect saved results. Human review remains required.")


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    main()
