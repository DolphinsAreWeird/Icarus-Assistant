"""Price history: download once, save to disk, read from disk.

Files: data/snapshots/history/<asset_id>_<interval>.json, where interval is
"1d" (3 years of daily closes) or "1h" (7 days of hourly closes).
Each row: {"t": open time in UTC, "close_usd": ..., "close_thb": ...}.
"""
import json
import time
from datetime import UTC, datetime, timedelta

from app.config import HISTORY_DAYS, HISTORY_DIR, SNAPSHOT_DIR
from app.market.sources import fetch_klines, fetch_usd_thb_history
from app.market.validate import fx_for_day, normalize_candles

FX_HISTORY_FILE = SNAPSHOT_DIR / "fx_history.json"


def history_file(asset_id: str, interval: str, history_dir=HISTORY_DIR):
    return history_dir / f"{asset_id}_{interval}.json"


def download_fx_history() -> dict[str, float]:
    today = datetime.now(UTC).date()
    # A few extra days so the first candle always has an earlier business day to use.
    start = today - timedelta(days=HISTORY_DAYS["1d"] + 7)
    fx = fetch_usd_thb_history(start, today)
    FX_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)
    FX_HISTORY_FILE.write_text(json.dumps(fx, indent=0))
    return fx


def _fixed_rows(price_usd: float, fx: dict[str, float], start: datetime,
                step: timedelta, now: datetime) -> list[dict]:
    """History for a fixed-price asset like USDT: flat in USD, moves with FX in THB."""
    rows, t = [], start
    while t + step <= now:
        rate = fx_for_day(fx, t.date().isoformat())
        rows.append({"t": t.isoformat(timespec="seconds"), "close_usd": price_usd,
                     "close_thb": round(price_usd * rate, 2)})
        t += step
    return rows


def download_history(asset_id: str, asset: dict, fx: dict[str, float]) -> dict[str, int]:
    """Download and save every interval for one asset. Returns row counts."""
    HISTORY_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(UTC)
    counts = {}
    for interval, days in HISTORY_DAYS.items():
        start = (now - timedelta(days=days)).replace(minute=0, second=0, microsecond=0)
        if interval == "1d":
            start = start.replace(hour=0)
        if asset["source"] == "binance":
            raw = fetch_klines(asset["symbol"], interval, int(start.timestamp() * 1000))
            rows = normalize_candles(raw, fx, int(time.time() * 1000))
        else:
            step = timedelta(days=1) if interval == "1d" else timedelta(hours=1)
            rows = _fixed_rows(asset["price_usd"], fx, start, step, now)
        history_file(asset_id, interval).write_text(json.dumps(rows, indent=0))
        counts[interval] = len(rows)
    return counts


def load_history(asset_id: str, interval: str, history_dir=HISTORY_DIR) -> list[dict]:
    path = history_file(asset_id, interval, history_dir)
    return json.loads(path.read_text()) if path.exists() else []


# Chart period (the app's names) -> (candle interval, number of candles)
PERIODS = {"1D": ("1h", 24), "1W": ("1h", 168), "1M": ("1d", 30), "3M": ("1d", 90),
           "1Y": ("1d", 365), "ALL": ("1d", 3 * 365)}  # ALL: all the history we keep


def period_rows(asset_id: str, period: str, history_dir=HISTORY_DIR) -> list[dict]:
    interval, count = PERIODS[period]
    return load_history(asset_id, interval, history_dir)[-count:]


def summarize(rows: list[dict]) -> dict | None:
    """What the LLM needs about a chart: start, end, change, high, low. Not every point."""
    if not rows:
        return None
    first, last = rows[0], rows[-1]
    high = max(rows, key=lambda r: r["close_thb"])
    low = min(rows, key=lambda r: r["close_thb"])
    return {
        "start": {"t": first["t"], "close_thb": first["close_thb"]},
        "end": {"t": last["t"], "close_thb": last["close_thb"]},
        "change_pct": round((last["close_thb"] / first["close_thb"] - 1) * 100, 2),
        "high": {"t": high["t"], "close_thb": high["close_thb"]},
        "low": {"t": low["t"], "close_thb": low["close_thb"]},
        "points": len(rows),
    }
