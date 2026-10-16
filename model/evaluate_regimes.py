"""Historical robustness checks across expanding, non-overlapping test windows.

These windows are development backtests on already available history, not fresh
forward validation or independent observations across correlated assets.
"""
import json
from icarus_core import ROOT, history
from forecast_intervals import experiment
from market_validation import atomic_json


def cutoffs(observations):
    if observations < 600:
        raise ValueError("At least 600 returns required.")
    ends = []
    for end in range(600, observations, 200):
        if end <= int(observations*.8) and (not ends or int(end*.8) >= ends[-1]):
            ends.append(end)
    ends.append(observations)
    return ends


def evaluate_asset(asset):
    source = history(asset)
    windows = []
    for end in cutoffs(len(source["points"])-1):
        data = {**source, "points":source["points"][:end+1], "coverage_end":source["points"][end]["date"]}
        report = experiment(data)
        selected = report["test_metrics"]["selected_calibrated"]
        reference = report["test_metrics"]["rolling_reference_uncalibrated"]
        windows.append({"input_sha256":report["input_sha256"], "as_of":report["as_of"],
                        "test_dates":report["split_dates"]["test"], "selected_candidate":report["selected_candidate"],
                        "selected_calibrated":selected, "rolling_reference":reference,
                        "interval_score_difference":selected["mean_interval_score_log_return_pct"]-reference["mean_interval_score_log_return_pct"]})
    return {"asset_id":asset,"quote_currency":"USDT", "windows":windows,
            "windows_meeting_nominal_coverage":sum(w["selected_calibrated"]["empirical_coverage_pct"] >= 90 for w in windows),
            "windows_beating_reference_score":sum(w["interval_score_difference"] < 0 for w in windows)}


def main():
    assets = [evaluate_asset(asset) for asset in ("btc", "eth", "gold")]
    report = {"status":"historical_development_backtest", "nominal_coverage_pct":90,
              "limits":["No test-window overlap within an asset; gaps between windows are possible.",
                        "Available history has already informed development; no new forward evaluation is claimed.",
                        "No pooled significance or independence claim across windows or assets.",
                        "No parameters, calibration rules or production selections are changed by this check."],
              "assets":assets}
    atomic_json(ROOT/"results"/"forecast_regimes.json", report)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
