"""Shared daily-series validation and atomic artifact writes."""
from datetime import date
from decimal import Decimal, InvalidOperation
import json
import os
from pathlib import Path
import uuid


def validate_daily_series(data, expected_asset=None):
    if not isinstance(data, dict) or data.get("currency") != "USDT":
        raise ValueError("UNSUPPORTED_QUOTE_CURRENCY")
    if expected_asset is not None and (data.get("asset_id") != expected_asset or data.get("origin") != "real_historical"):
        raise ValueError("HISTORY_IDENTITY_MISMATCH")
    points = data.get("points")
    if not isinstance(points, list) or len(points) < 2:
        raise ValueError("HISTORY_UNAVAILABLE")
    try:
        dates = [date.fromisoformat(point["date"]) for point in points]
        if any(str(parsed) != point["date"] for parsed, point in zip(dates, points)):
            raise ValueError("INVALID_DATE_FORMAT")
        if any((b-a).days != 1 for a, b in zip(dates, dates[1:])) or data.get("gaps"):
            raise ValueError("HISTORY_HAS_GAPS_OR_DUPLICATES")
        if data.get("coverage_start") != points[0]["date"] or data.get("coverage_end") != points[-1]["date"]:
            raise ValueError("COVERAGE_METADATA_MISMATCH")
        for row in points:
            close = Decimal(str(row["close"]))
            if not close.is_finite() or not Decimal("1e-18") <= close <= Decimal("1e15"):
                raise ValueError("INVALID_CLOSES")
            if any(field in row for field in ("open", "high", "low", "volume")):
                opened, high, low, volume = [Decimal(str(row[field])) for field in ("open", "high", "low", "volume")]
                if not all(value.is_finite() for value in (opened, high, low, volume)) or not 0 <= volume <= Decimal("1e30") or not (
                        Decimal("1e-18") <= low <= min(opened, close) <= max(opened, close) <= high <= Decimal("1e15")):
                    raise ValueError("INVALID_OHLC")
    except (KeyError, TypeError, InvalidOperation, OverflowError):
        raise ValueError("INVALID_HISTORY_RECORD") from None
    return data


def validate_forecast(data, asset):
    if not isinstance(data, dict) or data.get("asset_id") != asset or data.get("quote_currency") != "USDT" or data.get("status") != "experimental_historical_cutoff":
        raise ValueError("FORECAST_IDENTITY_MISMATCH")
    try:
        if str(date.fromisoformat(data["as_of"])) != data["as_of"]:
            raise ValueError("INVALID_FORECAST_DATE")
        for field in ("rolling_20_next_day_volatility_pct", "ewma_094_next_day_volatility_pct"):
            value = Decimal(str(data[field]))
            if not value.is_finite() or not 0 <= value <= 1e6:
                raise ValueError("INVALID_FORECAST_VALUE")
        interval = data.get("return_interval", {})
        if not isinstance(interval, dict):
            raise ValueError("INVALID_FORECAST_INTERVAL")
        if "next_day_simple_return_interval_pct" in interval:
            bounds = interval["next_day_simple_return_interval_pct"]
            lower, upper = Decimal(str(bounds["lower"])), Decimal(str(bounds["upper"]))
            test = interval["test_metrics"]["selected_calibrated"]
            coverage, nominal = Decimal(str(test["empirical_coverage_pct"])), Decimal(str(interval["nominal_coverage_pct"]))
            if not all(value.is_finite() for value in (lower, upper, coverage, nominal)) or not (
                    -100 <= lower <= upper <= Decimal("1e6") and 0 <= coverage <= 100 and 0 < nominal < 100):
                raise ValueError("INVALID_FORECAST_INTERVAL")
            if type(test["observations"]) is not int or test["observations"] < 1 or interval.get("as_of") != data["as_of"]:
                raise ValueError("INVALID_FORECAST_INTERVAL")
    except (KeyError, TypeError, InvalidOperation, OverflowError):
        raise ValueError("INVALID_FORECAST_ARTIFACT") from None
    return data


def atomic_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        candidate = path.with_name(path.name+"-"+uuid.uuid4().hex+".tmp")
        with candidate.open("x", encoding="utf-8") as handle:
            temporary = candidate
            json.dump(data, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
