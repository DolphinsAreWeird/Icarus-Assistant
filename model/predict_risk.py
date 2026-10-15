"""Chronological, exploratory next-day squared-log-return risk baseline evaluation."""
import argparse
import json
import math
from pathlib import Path
import statistics

from icarus_core import ROOT, history


def experiment(asset):
    data = history(asset)
    closes = [float(point["close"]) for point in data["points"]]
    returns = [math.log(b/a) for a,b in zip(closes,closes[1:])]
    if len(returns) < 120:
        raise ValueError("At least 120 daily returns required for this exploratory experiment.")
    # These settings are fixed before evaluation, not chosen on the test data.
    split, window, decay = max(60,int(len(returns)*0.8)),20,0.94
    ewma = statistics.mean(r*r for r in returns[:window])
    scores = {"rolling_20":[],"ewma_094":[]}
    for index in range(window,len(returns)):
        rolling = statistics.mean(r*r for r in returns[index-window:index])
        if index >= split:
            actual = returns[index]**2
            for model,prediction in (("rolling_20",rolling),("ewma_094",ewma)):
                scores[model].append((prediction-actual)**2)
        ewma = decay*ewma+(1-decay)*returns[index]**2
    final_rolling = statistics.mean(r*r for r in returns[-window:])
    report = {"asset_id":asset,"quote_currency":"USDT","status":"experimental_historical_cutoff",
              "source_url":data["source_url"],"coverage_start":data["coverage_start"],"training_cutoff":data["points"][split]["date"],
              "as_of":data["coverage_end"],"horizon":"next calendar day after as_of, not necessarily today",
              "target":"next-day squared log return; a noisy daily variance proxy",
              "test_observations":len(scores["rolling_20"]),
              "test_mse":{name:statistics.mean(values) for name,values in scores.items()},
              "rolling_20_next_day_volatility_pct":round(math.sqrt(final_rolling)*100,4),
              "ewma_094_next_day_volatility_pct":round(math.sqrt(ewma)*100,4),
              "limits":["No prediction of direction, expected profit, or suitability.",
                        "No confidence interval or coverage claim; model assumptions are unvalidated.",
                        "Historical test comparison only; no tuning or model selection performed on the test set.",
                        "Squared daily return is a noisy variance proxy; this is not intraday realized volatility.",
                        "Saved cutoff may be old. No live forecast is implied."]}
    target = ROOT / "data" / "forecasts" / f"{asset}.json"
    target.parent.mkdir(exist_ok=True,parents=True)
    target.write_text(json.dumps(report,indent=2),encoding="utf-8")
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset",choices=["btc","eth","gold"],default="btc")
    args = parser.parse_args()
    print(json.dumps(experiment(args.asset),indent=2))
