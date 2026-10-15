"""Check and normalize raw API data before it goes into the cache.

Anything that fails a check raises BadPrice. The caller keeps the last good value.
"""
import math
from bisect import bisect_right
from datetime import UTC, datetime

from app.config import MAX_JUMP_PCT


class BadPrice(ValueError):
    pass


def ms_to_iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="seconds")


def _positive(value) -> float:
    x = float(value)
    if not math.isfinite(x) or x <= 0:
        raise BadPrice(f"not a positive price: {value!r}")
    return x


def normalize_ticker(raw: dict, asset_id: str, usd_thb: float, fetched_at: float) -> dict:
    """Turn one Binance 24h ticker into our price entry."""
    price = _positive(raw["lastPrice"])
    change = float(raw["priceChangePercent"])
    if not -90 < change < 1000:
        raise BadPrice(f"{asset_id}: 24h change {change}% looks wrong")
    return {
        "asset_id": asset_id,
        "price_usd": price,
        "price_thb": round(price * usd_thb, 2),
        "change_24h_pct": round(change, 2),
        "as_of": ms_to_iso(raw["closeTime"]),
        "source": "binance",
        "fetched_at": fetched_at,
    }


def check_jump(new_price: float, last_price: float | None) -> None:
    """Reject a price that moved too far from the last one. Likely a bad tick."""
    if last_price is None:
        return
    moved = abs(new_price - last_price) / last_price * 100
    if moved > MAX_JUMP_PCT:
        raise BadPrice(f"price moved {moved:.1f}% in one poll")


def fx_for_day(fx_by_day: dict[str, float], day: str) -> float:
    """Rate for that day, or the last business day before it (weekends, holidays)."""
    days = sorted(fx_by_day)
    i = bisect_right(days, day)
    return fx_by_day[days[max(i - 1, 0)]]


def normalize_candles(raw: list[list], fx_by_day: dict[str, float], now_ms: int) -> list[dict]:
    """Binance candles to [{t, close_usd, close_thb}], using each day's own FX rate.

    Drops the candle that is still open; the live price covers "right now".
    """
    rows = []
    for candle in raw:
        open_ms, close, close_ms = candle[0], candle[4], candle[6]
        if close_ms > now_ms:
            continue
        t = ms_to_iso(open_ms)
        close_usd = _positive(close)
        rate = fx_for_day(fx_by_day, t[:10])
        rows.append({"t": t, "close_usd": close_usd, "close_thb": round(close_usd * rate, 2)})
    return rows
