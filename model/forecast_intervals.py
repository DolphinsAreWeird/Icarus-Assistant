"""Causal daily-return intervals with separate selection, calibration and test periods.

Standard-library experiment, not a current trading signal. The nominal coverage
is a target: dependent, changing market returns do not satisfy the usual
exchangeability assumptions for a distribution-free conformal guarantee.
"""
import hashlib
import json
import math
import statistics
from datetime import date


VERSION = "daily-return-interval-v1"
ALPHA = 0.10
WINDOW = 250
WARMUP = 20
DECAY = 0.94


def quantile(values, probability):
    """Linearly interpolated empirical quantile, with explicit endpoint behavior."""
    ordered = sorted(values)
    if not ordered or not 0 <= probability <= 1:
        raise ValueError("INVALID_QUANTILE")
    position = (len(ordered)-1)*probability
    lower = int(position)
    upper = min(lower+1, len(ordered)-1)
    return ordered[lower] + (position-lower)*(ordered[upper]-ordered[lower])


def candidate_predictions(returns):
    """Prediction at index t uses returns strictly before t; includes t=len(data).

    EWMA innovations use the variance available BEFORE that innovation. Reusing
    a variance fitted to the entire series here would leak future information.
    """
    if len(returns) < WARMUP or any(not math.isfinite(r) for r in returns):
        raise ValueError("INVALID_RETURNS")
    variance = statistics.mean(r*r for r in returns[:WARMUP])
    innovations = []
    predictions = {"rolling_quantile_250": {}, "ewma_scaled_quantile_250": {}}
    for index in range(WARMUP, len(returns)+1):
        sigma = math.sqrt(max(variance, 1e-16))
        if index >= WINDOW + WARMUP:
            prior = returns[index-WINDOW:index]
            scaled = innovations[-WINDOW:]
            predictions["rolling_quantile_250"][index] = (
                quantile(prior, ALPHA/2), quantile(prior, 1-ALPHA/2))
            predictions["ewma_scaled_quantile_250"][index] = (
                sigma*quantile(scaled, ALPHA/2), sigma*quantile(scaled, 1-ALPHA/2))
        if index < len(returns):
            innovations.append(returns[index]/sigma)
            variance = DECAY*variance + (1-DECAY)*returns[index]**2
    return predictions


def interval_score(lower, upper, actual):
    """Proper central interval score: width plus missed-tail penalties."""
    return upper-lower + (2/ALPHA)*(max(lower-actual, 0)+max(actual-upper, 0))


def metrics(predictions, returns, start, stop, expansion=0):
    rows = [(predictions[i][0]-expansion, predictions[i][1]+expansion, returns[i])
            for i in range(start, stop)]
    return {"observations": len(rows),
            "empirical_coverage_pct": 100*statistics.mean(lo <= y <= hi for lo, hi, y in rows),
            "mean_width_log_return_pct": 100*statistics.mean(hi-lo for lo, hi, _ in rows),
            "mean_interval_score_log_return_pct": 100*statistics.mean(
                interval_score(lo, hi, y) for lo, hi, y in rows)}


def calibration_expansion(scores):
    """Nonnegative split-calibration order statistic; never silently cap rank."""
    rank = math.ceil((len(scores)+1)*(1-ALPHA))
    if not scores or rank > len(scores):
        raise ValueError("INSUFFICIENT_CALIBRATION_DATA")
    return sorted(scores)[rank-1]


def evaluate_returns(returns):
    if len(returns) < 600:
        raise ValueError("At least 600 daily returns required for four chronological periods.")
    n = len(returns)
    selection_start, calibration_start, test_start = int(n*.50), int(n*.65), int(n*.80)
    predictions = candidate_predictions(returns)
    selection = {name: metrics(rows, returns, selection_start, calibration_start)
                 for name, rows in predictions.items()}
    selected = min(selection, key=lambda name: selection[name]["mean_interval_score_log_return_pct"])
    chosen = predictions[selected]
    scores = [max(chosen[i][0]-returns[i], returns[i]-chosen[i][1], 0)
              for i in range(calibration_start, test_start)]
    expansion = calibration_expansion(scores)
    lower, upper = chosen[n]
    return {"version": VERSION, "selected_candidate": selected,
            "nominal_coverage_pct": 100*(1-ALPHA),
            "parameters": {"lookback_days": WINDOW, "ewma_decay": DECAY, "warmup_days": WARMUP},
            "split_indices": {"initial_history": [0, selection_start],
                              "model_selection": [selection_start, calibration_start],
                              "calibration": [calibration_start, test_start], "test": [test_start, n]},
            "selection_metrics": selection,
            "calibration": {"observations": len(scores), "expansion_log_return": expansion,
                            "order_statistic_rank": math.ceil((len(scores)+1)*(1-ALPHA))},
            "test_metrics": {
                "selected_calibrated": metrics(chosen, returns, test_start, n, expansion),
                "selected_uncalibrated": metrics(chosen, returns, test_start, n),
                "rolling_reference_uncalibrated": metrics(
                    predictions["rolling_quantile_250"], returns, test_start, n)},
            "next_day_simple_return_interval_pct": {
                "lower": round(100*math.expm1(lower-expansion), 4),
                "upper": round(100*math.expm1(upper+expansion), 4)}}


def experiment(data):
    points = data["points"]
    if data.get("currency") != "USDT":
        raise ValueError("UNSUPPORTED_QUOTE_CURRENCY")
    if not points:
        raise ValueError("HISTORY_UNAVAILABLE")
    dates = [date.fromisoformat(point["date"]) for point in points]
    if any(str(parsed) != point["date"] for parsed, point in zip(dates, points)):
        raise ValueError("INVALID_DATE_FORMAT")
    if any((later-earlier).days != 1 for earlier, later in zip(dates, dates[1:])):
        raise ValueError("HISTORY_NOT_CONTIGUOUS_DAILY")
    if data.get("coverage_start") != points[0]["date"] or data.get("coverage_end") != points[-1]["date"]:
        raise ValueError("COVERAGE_METADATA_MISMATCH")
    closes = [float(point["close"]) for point in points]
    if any(not math.isfinite(c) or c <= 0 for c in closes):
        raise ValueError("INVALID_CLOSES")
    returns = [math.log(b/a) for a, b in zip(closes, closes[1:])]
    report = evaluate_returns(returns)
    # Hash normalized observations, not a mutable path or a rounded metric.
    canonical = json.dumps(points, sort_keys=True, separators=(",", ":")).encode("utf-8")
    report.update({"input_sha256": hashlib.sha256(canonical).hexdigest(),
                   "as_of": data["coverage_end"], "quote_currency": data["currency"],
                   "target": "next calendar day's close-to-close simple return in USDT",
                   "selection_rule": "lowest interval score on model_selection only; fixed before test",
                   "update_rule": "walk forward: observed past returns update candidates; selection and calibration expansion stay frozen",
                   "split_dates": {name: {"first_target_date": points[start+1]["date"],
                                          "last_target_date": points[stop]["date"],
                                          "observations": stop-start}
                                   for name, (start, stop) in report["split_indices"].items()},
                   "limits": ["Nominal coverage is a target, not a guaranteed probability or maximum loss.",
                              "Time dependence, adaptive rolling estimates and regime changes invalidate an automatic exchangeability guarantee.",
                              "Test observations are excluded from selection and calibration, but earlier test observations update later forecasts.",
                              "One split, one venue and daily closes; no trading costs or intraday risk model.",
                              "Saved historical cutoff, not a current forecast or recommendation."]})
    return report
