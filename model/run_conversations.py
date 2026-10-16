"""Replay bilingual multi-turn demo scenarios with explicit profile-state checks."""
import argparse
from datetime import datetime,timezone
import json

from icarus_core import ROOT,read_json
from session import ConversationSession


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live",action="store_true",help="Use quota for non-template model turns")
    parser.add_argument("--lang",choices=["en","th","both"],default="both")
    args = parser.parse_args()
    cases = read_json(ROOT/"evaluation"/"conversations.json")
    reports = []
    for case in cases:
        if args.lang != "both" and case["language"] != args.lang:
            continue
        state = ConversationSession(case["profile"],case["language"],today="2026-10-15")
        turns = []
        for step in case["turns"]:
            result = state.ask(step["message"],offline=not args.live)
            context = result["guidance_context"]
            checks = {"complete":result["status"]=="ok"}
            if "expected_missing" in step:
                checks["missing_fields"] = context["missing_for_personalization"]==step["expected_missing"]
            if "expected_profile" in step:
                checks["profile_fields"] = all(state.profile.get(key)==value for key,value in step["expected_profile"].items())
            if "expected_route" in step:
                checks["route"] = result["route"]==step["expected_route"]
                checks["no_model_for_intake"] = result["model_calls"]==[]
            if "expected_conflict" in step:
                checks["corrected_constraint"] = context["essential_near_term_conflict"]==step["expected_conflict"]
            if "expected_tool" in step:
                names = [source["data"].get("tool") for source in result["sources"]]
                checks["tool"] = step["expected_tool"] in names if args.live else None
            row = {"input":step,"result":result,"checks":checks,"semantic_review":"pending"}
            turns.append(row)
            print(json.dumps({"case":case["id"],"turn":len(turns),"checks":checks,
                              "text":result["text"],"seconds":result["elapsed_seconds"]},ensure_ascii=False),flush=True)
        reports.append({"id":case["id"],"turns":turns})
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    target = ROOT/"results"/f"conversations_{'live' if args.live else 'offline'}_{stamp}.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps({"live":args.live,"reports":reports},ensure_ascii=False,indent=2),encoding="utf-8")
    if any(value is False for report in reports for turn in report["turns"] for value in turn["checks"].values()):
        raise SystemExit("Conversation checks failed. Inspect the saved report.")


if __name__ == "__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    main()
