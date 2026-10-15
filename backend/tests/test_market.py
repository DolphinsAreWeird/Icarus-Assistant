import json

import pytest

from app.market import cache as cache_mod
from app.market.cache import PriceCache
from app.market.validate import (BadPrice, check_jump, fx_for_day, normalize_candles,
                                 normalize_ticker)

ASSETS = {
    "btc": {"source": "binance", "symbol": "BTCUSDT"},
    "usdt": {"source": "fixed", "price_usd": 1.0},
}


def ticker(price="80000", change="1.5", symbol="BTCUSDT"):
    return {"symbol": symbol, "lastPrice": price, "priceChangePercent": change,
            "closeTime": 1792055509013}


# ---------- validate ----------

@pytest.mark.parametrize("price", ["0", "-5", "nan", "inf"])
def test_rejects_bad_prices(price):
    with pytest.raises(BadPrice):
        normalize_ticker(ticker(price=price), "btc", 33.5, 0)


def test_rejects_silly_24h_change():
    with pytest.raises(BadPrice):
        normalize_ticker(ticker(change="-95"), "btc", 33.5, 0)


def test_converts_to_thb():
    entry = normalize_ticker(ticker(price="100"), "btc", 33.5, 0)
    assert entry["price_thb"] == 3350.0
    assert entry["source"] == "binance"


def test_jump_check():
    check_jump(110, 100)    # 10% is fine
    check_jump(100, None)   # nothing to compare against
    with pytest.raises(BadPrice):
        check_jump(130, 100)


def test_fx_uses_last_business_day():
    fx = {"2026-10-09": 33.0, "2026-10-12": 34.0}
    assert fx_for_day(fx, "2026-10-11") == 33.0  # Sunday uses Friday
    assert fx_for_day(fx, "2026-10-12") == 34.0
    assert fx_for_day(fx, "2026-01-01") == 33.0  # before the data: first rate


def test_candles_drop_the_open_one_and_use_daily_fx():
    day = 86_400_000
    t0 = 1_791_936_000_000  # 2026-10-14 00:00 UTC
    raw = [
        [t0, "1", "1", "1", "100", "0", t0 + day - 1],
        [t0 + day, "1", "1", "1", "200", "0", t0 + 2 * day - 1],  # still open
    ]
    rows = normalize_candles(raw, {"2026-10-14": 30.0}, now_ms=t0 + day + 5)
    assert rows == [{"t": "2026-10-14T00:00:00+00:00", "close_usd": 100.0, "close_thb": 3000.0}]


# ---------- cache ----------

class FakeClock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


@pytest.fixture
def fake_sources(monkeypatch):
    state = {"price": "80000", "fail": False}

    def tickers(symbols):
        if state["fail"]:
            raise cache_mod.httpx.ConnectError("no wifi")
        return [ticker(price=state["price"])]

    monkeypatch.setattr(cache_mod, "fetch_tickers", tickers)
    monkeypatch.setattr(cache_mod, "fetch_usd_thb",
                        lambda: {"rate": 33.5, "as_of": "2026-10-14", "source": "test"})
    return state


def test_live_then_delayed(tmp_path, fake_sources):
    clock = FakeClock()
    c = PriceCache(ASSETS, offline=False, snapshot_file=tmp_path / "p.json", clock=clock)
    assert c.refresh() == []
    assert c.get("btc")["freshness"] == "live"
    assert c.get("usdt")["price_thb"] == 33.5

    fake_sources["fail"] = True
    clock.t += 300
    assert c.refresh()  # reports the failure
    assert c.get("btc")["price_usd"] == 80000.0  # keeps the last good price
    assert c.get("btc")["freshness"] == "delayed"


def test_bad_tick_is_rejected(tmp_path, fake_sources):
    clock = FakeClock()
    c = PriceCache(ASSETS, offline=False, snapshot_file=tmp_path / "p.json", clock=clock)
    c.refresh()
    fake_sources["price"] = "8000"  # a 90% drop in 15 s
    clock.t += 15
    problems = c.refresh()
    assert any("btc" in p for p in problems)
    assert c.get("btc")["price_usd"] == 80000.0


def test_offline_serves_snapshot(tmp_path, fake_sources):
    snap = tmp_path / "p.json"
    PriceCache(ASSETS, offline=False, snapshot_file=snap, clock=FakeClock()).refresh()
    assert json.loads(snap.read_text())["prices"]["btc"]["price_usd"] == 80000.0

    fake_sources["fail"] = True
    c = PriceCache(ASSETS, offline=True, snapshot_file=snap, clock=FakeClock())
    c.refresh()
    assert c.get("btc")["freshness"] == "offline"
    assert c.get("btc")["price_usd"] == 80000.0
