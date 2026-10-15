"""Offline engineering checkpoint. No gateway requests or downloaded data fabrication."""
import json
import subprocess
import sys
import time
from icarus_core import ROOT, history, risk_forecast
from market_validation import atomic_json


def main():
    rows = []
    checks = [("unit_tests", ["-m", "unittest", "discover", "-s", str(ROOT/"tests"), "-q"]),
              ("retrieval_regression", [str(ROOT/"evaluate_retrieval.py")]),
              ("retrieval_challenge", [str(ROOT/"evaluate_retrieval.py"), "--suite", "challenge"]),
              ("numeric_execution", [str(ROOT/"evaluate_assistant.py"), "--no-network", "--suite", "numeric", "--limit", "6"])]
    for name, arguments in checks:
        started = time.perf_counter()
        try:
            result = subprocess.run([sys.executable, *arguments], cwd=ROOT.parent, capture_output=True,
                                    text=True, encoding="utf-8", errors="replace", timeout=60)
            passed, details = result.returncode == 0, (result.stdout+result.stderr)[-2500:]
        except (OSError, subprocess.TimeoutExpired) as exc:
            passed, details = False, type(exc).__name__
        rows.append({"check":name,"passed":passed,"seconds":round(time.perf_counter()-started,3), "details":details})
    market = []
    for asset in ("btc", "eth", "gold"):
        try:
            data, forecast = history(asset), risk_forecast(asset)
            passed = forecast.get("as_of") == data["coverage_end"]
            market.append({"asset":asset,"passed":passed,"observations":len(data["points"]),
                           "historical_cutoff":data["coverage_end"],"current_forecast_claimed":False})
        except (OSError, ValueError, KeyError, TypeError):
            market.append({"asset":asset,"passed":False,"reason":"Prepare valid market data and regenerate forecasts."})
    report = {"status":"passed" if all(row["passed"] for row in [*rows,*market]) else "failed",
              "checks":rows,"market":market,"network_requests":0,
              "pending_human_review":["Luka/First: Thai wording, source meaning and financial guidance examples."],
              "limits":["Offline checks do not establish current gateway availability or semantic answer quality.",
                        "Historical backtests do not establish trading advantage or guaranteed interval coverage."]}
    atomic_json(ROOT/"results"/"checkpoint_verification.json", report)
    print(json.dumps({"status":report["status"],"checks":[{"check":row["check"],"passed":row["passed"]} for row in rows],
                      "market":market,"pending_human_review":report["pending_human_review"]},indent=2))
    raise SystemExit(report["status"] != "passed")


if __name__ == "__main__":
    main()
