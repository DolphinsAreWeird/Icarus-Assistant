"""Prepare a bilingual human-review packet using synthetic profiles and curated cases."""
import argparse
from datetime import datetime, timezone, timedelta
import json
import subprocess

from assistant import answer
from session import ConversationSession
from icarus_core import ROOT, read_json
from market_validation import atomic_json


TOPICS = [
    ("fees", "Mock fees and purchase budget", "Budget includes the mock fee. No real trade or actual app fee is implied.", "/fee 1000", "new"),
    ("savings", "Savings without investment returns", "Target/current amounts keep their roles; first contribution and fixed demo date are clear. No interest or return promise.", "/goal 50000 1000 THB 2027-06-15", "new"),
    ("essential", "Essential tuition money", "Respect the near-term essential expense; high willingness to take risk does not create loss capacity.", "near_term", "near_term"),
    ("correction", "Corrected user circumstances", "Use the corrected shorter horizon; do not ask already answered questions or confuse risk preference with loss capacity.", "context", "new"),
    ("portfolio", "Visible portfolio concentration", "Include cash in the denominator. Explain only the visible synthetic account, not total wealth or an appropriate allocation.", "/portfolio", "concentrated"),
    ("comparison", "Historical asset comparison", "Compare the same historical dates and USDT units. A historical winner is not a recommended future winner.", "/compare btc gold", "long_term"),
    ("whatif", "Historical hypothetical purchase", "Preserve ETH, amount, dates and USDT. Exclude fees/spread/slippage and distinguish a hypothetical from actual performance.", "/whatif eth 1000 USDT 2024-01-01 2026-09-30", "new"),
    ("forecast", "Prediction uncertainty", "Historical cutoff only. Nominal coverage is a target, not a probability guarantee or maximum loss. Mention the failed reference comparison.", "/risk btc", "experienced"),
    ("gold", "Gold-token ownership and redemption", "PAXG is not unrestricted physical-bar access; preserve issuer eligibility, verification and redemption conditions.", "gold", "new"),
    ("start", "First personalized guidance", "Ask focused missing-context questions. No invented allocation, profit target or assumption that stated money is affordable to lose.", "start", "new"),
    ("slippage", "Slippage and execution protection", "Distinguish possible price changes from a diagnosis. A tolerance does not guarantee successful execution or establish Icarus settings.", "slippage", "new"),
    ("stablecoin", "Stablecoin yield and currency", "Variable lending yield is not fixed savings interest. USDT is not automatically USD or THB; no live yield quote.", "stablecoin", "new"),
]


def timestamp_key(value):
    try:
        parsed = datetime.fromisoformat(value)
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else datetime.min.replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return datetime.min.replace(tzinfo=timezone.utc)


def recorded_results():
    latest = {}
    for path in (ROOT/"results").glob("assistant_*.json"):
        try:
            payload = read_json(path)
        except (OSError, ValueError, UnicodeError):
            continue
        for row in payload.get("results", []):
            case = row.get("case", {})
            result = row.get("result", {})
            if case.get("id") and result.get("status") == "ok" and result.get("route") == "qwen_grounded":
                stamp = payload.get("run_at", "")
                if timestamp_key(stamp) > timestamp_key(latest.get(case["id"], {}).get("run_at", "")):
                    latest[case["id"]] = {"result":result,"run_at":stamp,"file":path.name}
    packet = ROOT/"evaluation"/"review"/"financial_review_samples.json"
    if packet.exists():
        payload = read_json(packet)
        for row in payload.get("samples", []):
            result = row.get("result", {})
            if result.get("status") == "ok" and result.get("route") == "qwen_grounded":
                stamp = row.get("response_generated_at", payload.get("generated_at", ""))
                if timestamp_key(stamp) > timestamp_key(latest.get(row["id"], {}).get("run_at", "")):
                    latest[row["id"]] = {"result":result,"run_at":stamp,"file":packet.name,
                                         "source_revision":row.get("response_source_revision", payload.get("source_revision", "not captured"))}
    return latest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--refresh-live", action="store_true", help="Refresh eight open-ended Qwen examples; consumes quota")
    args = parser.parse_args()
    examples = {row["id"]:row for row in read_json(ROOT/"evaluation"/"cases.json")}
    stress = {row["id"]:row for row in read_json(ROOT/"evaluation"/"stress_cases.json")}
    records = {row["id"]:row for row in read_json(ROOT/"knowledge"/"records.json")}
    saved, rows = recorded_results(), []
    revision = subprocess.run(["git","rev-parse","HEAD"], cwd=ROOT.parent, capture_output=True, text=True, check=True).stdout.strip()
    generated = datetime.now(timezone(timedelta(hours=7))).isoformat()
    for key, title, criterion, request, profile in TOPICS:
        for language in ("en", "th"):
            case_id = key+"_"+language
            origin = "current deterministic execution"
            response_generated_at, response_revision = generated, revision
            if request.startswith("/"):
                message = request
                result = answer(message, language=language, profile_id=profile, today="2026-10-15")
            elif request == "context":
                case = stress["context_"+language]
                message = "\n".join(case["turns"])
                state = ConversationSession(language=language, today="2026-10-15")
                for turn in case["turns"]:
                    result = state.ask(turn)
            else:
                case = examples[request+"_"+language]
                message = case["message"]
                if request == "near_term" or args.refresh_live:
                    result = answer(message, language=language, profile_id=profile, today="2026-10-15")
                    origin = "current execution" if not result["model_calls"] else "fresh Orion response"
                elif case["id"] in saved:
                    recorded = saved[case["id"]]
                    result = recorded["result"]
                    response_generated_at, response_revision = recorded["run_at"], recorded.get("source_revision", "not captured")
                    origin = f"recorded Orion response: {recorded['run_at']}; model revision {recorded.get('source_revision', 'not captured in that run')}"
                else:
                    result = {"status":"missing_sample", "text":"No completed sample available; regenerate with --refresh-live.",
                              "sources":[],"numerical_summaries":[],"limitations":[],"disclaimer":""}
                    origin = "missing sample"
            urls = set()
            for source in result["sources"]:
                data = source["data"]
                if data.get("source_url"):
                    urls.add(data["source_url"])
                tool = data.get("data", {})
                if tool.get("source_url"):
                    urls.add(tool["source_url"])
                for ref in tool.get("source_ids", []):
                    if records.get(ref, {}).get("source_url"):
                        urls.add(records[ref]["source_url"])
            rows.append({"id":case_id,"topic":title,"criterion":criterion,"language":language,"input":message,
                         "origin":origin,"response_generated_at":response_generated_at,"response_source_revision":response_revision,
                         "result":result,"source_urls":sorted(urls),"human_review":"pending"})
            print(json.dumps({"id":case_id,"status":result["status"],"origin":origin}), flush=True)
    directory = ROOT/"evaluation"/"review"
    atomic_json(directory/"financial_review_samples.json", {"generated_at":generated,"source_revision":revision,
                "demo_date":"2026-10-15","human_review":"pending","samples":rows})
    lines = ["# Financial review packet — pending", "", "Reviewers: Luka and First. All examples use synthetic profiles and a fixed demonstration date of 2026-10-15.", "",
             f"Generated at {generated}; source revision `{revision}`. Packet generation does not mark any example approved.", "",
             "Read the answer, numerical summary, limitation and cited source together. For recorded examples, the origin below identifies their older run; use `--refresh-live` to replace them. The current date behavior is tested separately.", "",
             "Record decisions in [FINANCIAL_REVIEW.md](../FINANCIAL_REVIEW.md).", ""]
    for row in rows:
        result = row["result"]
        lines += [f"## {row['id']} — {row['topic']}", "", f"Expected behavior: {row['criterion']}", "",
                  f"Sample origin: {row['origin']}. Execution status: `{result['status']}`. Human review: pending.", "", "User input:", "", "```text", row["input"], "```", "",
                  "Assistant answer:", "", result["text"], ""]
        for summary in result["numerical_summaries"]:
            if summary["text"] != result["text"]:
                lines += ["Numerical summary: "+summary["text"], ""]
        if result.get("disclaimer"):
            lines += ["Disclaimer: "+result["disclaimer"], ""]
        for limitation in result["limitations"]:
            lines += ["Limitation: "+limitation, ""]
        lines += ["Sources: "+("; ".join(f"[source {i+1}]({url})" for i,url in enumerate(row["source_urls"])) or
                   "Explicit mock fixture / local deterministic calculation; inspect the tool data in the JSON packet."), ""]
    directory.mkdir(parents=True, exist_ok=True)
    (directory/"FINANCIAL_REVIEW_PACKET.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
