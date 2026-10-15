"""Raw calls to outside APIs.

No caching or checks here. validate.py checks the numbers, cache.py keeps them.
Binance quotes in USDT. We treat 1 USDT as 1 USD, which is close enough for a demo.
"""
import json
from datetime import UTC, date, datetime

import httpx

from app.config import HTTP_TIMEOUT_S

BINANCE = "https://api.binance.com"
FRANKFURTER = "https://api.frankfurter.dev/v1"
ER_API = "https://open.er-api.com/v6/latest/USD"

KLINES_LIMIT = 1000  # Binance's max candles per call


def _get(url: str, params: dict | None = None):
    r = httpx.get(url, params=params, timeout=HTTP_TIMEOUT_S, follow_redirects=True)
    r.raise_for_status()
    return r.json()


def fetch_tickers(symbols: list[str]) -> list[dict]:
    """24h ticker for all symbols in one call."""
    return _get(f"{BINANCE}/api/v3/ticker/24hr",
                {"symbols": json.dumps(symbols, separators=(",", ":"))})


def fetch_klines(symbol: str, interval: str, start_ms: int) -> list[list]:
    """Candles from start_ms to now, paging past the 1000-candle limit."""
    candles = []
    while True:
        batch = _get(f"{BINANCE}/api/v3/klines", {
            "symbol": symbol, "interval": interval,
            "startTime": start_ms, "limit": KLINES_LIMIT,
        })
        candles.extend(batch)
        if len(batch) < KLINES_LIMIT:
            return candles
        start_ms = batch[-1][6] + 1  # index 6 is the candle's close time


def fetch_usd_thb() -> dict:
    """Latest USD to THB rate. Frankfurter (ECB) first, open.er-api.com as backup."""
    try:
        d = _get(f"{FRANKFURTER}/latest", {"base": "USD", "symbols": "THB"})
        return {"rate": d["rates"]["THB"], "as_of": d["date"], "source": "frankfurter"}
    except (httpx.HTTPError, KeyError):
        d = _get(ER_API)
        day = datetime.fromtimestamp(d["time_last_update_unix"], UTC).date()
        return {"rate": d["rates"]["THB"], "as_of": day.isoformat(), "source": "open.er-api"}


def fetch_usd_thb_history(start: date, end: date) -> dict[str, float]:
    """USD to THB per business day, as {"2026-10-14": 33.575, ...}."""
    d = _get(f"{FRANKFURTER}/{start.isoformat()}..{end.isoformat()}",
             {"base": "USD", "symbols": "THB"})
    return {day: rates["THB"] for day, rates in d["rates"].items()}
