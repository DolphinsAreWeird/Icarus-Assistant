"""The facts behind "how risky is it?", "what if I had...?" and "how much should I save?".

Pure functions over price history, so every number is exact and testable. The wording lives in the tools (tools.py), which
put the numbers next to a ready-to-say English and Thai sentence. Nothing here predicts anything: it describes the past, or
does plain arithmetic.
"""
import math
from collections import OrderedDict
from datetime import date
from decimal import ROUND_CEILING, Decimal
from statistics import median

MONTH_NUMBERS = {name: i for i, names in enumerate(
    ("january jan", "february feb", "march mar", "april apr", "may", "june jun", "july jul", "august aug",
     "september sep sept", "october oct", "november nov", "december dec"), start=1) for name in names.split()}


def risk_stats(rows: list[dict]) -> dict | None:
    """How an asset behaved over the history we have (daily closes in baht): the usual daily move, the worst and best
    calendar month, and the biggest fall from a peak. None when there is too little history to say anything."""
    closes = [(r["t"][:10], r["close_thb"]) for r in rows if r.get("close_thb")]
    if len(closes) < 60:
        return None
    daily = [abs(b / a - 1) * 100 for (_, a), (_, b) in zip(closes, closes[1:])]
    month_end: "OrderedDict[str, float]" = OrderedDict()
    for day, close in closes:
        month_end[day[:7]] = close  # the last close seen in each month
    ends = list(month_end.values())
    monthly = [(b / a - 1) * 100 for a, b in zip(ends, ends[1:])]  # the partial first and last months are not counted
    peak, max_drop = closes[0][1], 0.0
    for _, close in closes:
        peak = max(peak, close)
        max_drop = max(max_drop, (1 - close / peak) * 100)
    return {"days": len(closes), "from": closes[0][0], "to": closes[-1][0],
            "typical_day_move_pct": round(median(daily[-365:]), 2),
            "worst_month_pct": round(min(monthly), 1) if monthly else None,
            "best_month_pct": round(max(monthly), 1) if monthly else None,
            "max_drop_pct": round(max_drop, 1)}


def what_if(rows: list[dict], amount_thb: float) -> dict | None:
    """What amount_thb put in at the start of these daily or hourly closes would be worth at the end. Fees, spread and
    slippage are not included. A past result, not a forecast."""
    if len(rows) < 2 or amount_thb <= 0 or not math.isfinite(amount_thb):
        return None
    start, end = rows[0]["close_thb"], rows[-1]["close_thb"]
    if not start or not end:
        return None
    now_value = amount_thb * end / start
    return {"amount_thb": amount_thb, "from": rows[0]["t"][:10], "to": rows[-1]["t"][:10],
            "value_now_thb": round(now_value, 2), "change_thb": round(now_value - amount_thb, 2),
            "change_pct": round((end / start - 1) * 100, 2)}


def months_until(month: int, today: date) -> int:
    """Whole months from today to the end of the named month (the next one, if it has passed): June from October is 8.
    The same month is 1."""
    diff = (month - today.month) % 12
    return diff if diff > 0 else 1


def goal_math(target_thb: float, months: int, current_thb: float = 0.0) -> dict | None:
    """How much to put aside each month to reach target_thb in `months`, rounded UP to the next 10 baht so the goal is met.
    No interest or growth is assumed."""
    if not all(math.isfinite(v) for v in (target_thb, current_thb)) or target_thb <= 0 or current_thb < 0 or not 1 <= months <= 600:
        return None
    left = Decimal(str(target_thb)) - Decimal(str(current_thb))
    if left <= 0:
        return {"target_thb": target_thb, "current_thb": current_thb, "months": months, "reached": True, "monthly_thb": 0}
    monthly = (left / months / 10).to_integral_value(rounding=ROUND_CEILING) * 10
    return {"target_thb": target_thb, "current_thb": current_thb, "months": months, "reached": False,
            "monthly_thb": int(monthly), "left_thb": float(left)}
