"""Price cache: the one place prices come from, for the screens and for Icarus.

Order of fallback: live poll, then last good value ("delayed"), then the
snapshot file on disk ("offline").
"""
import json
import time
import threading
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy

import httpx

from app.config import JUMP_CHECK_MAX_AGE_S, LIVE_MAX_AGE_S, OFFLINE, SNAPSHOT_DIR
from app.market.sources import fetch_tickers, fetch_usd_thb, fetch_yahoo_chart
from app.market.validate import BadPrice, check_jump, normalize_ticker, normalize_yahoo_quote

SNAPSHOT_FILE = SNAPSHOT_DIR / "prices.json"
YAHOO_EVERY_S = 60


class PriceCache:
    def __init__(self, assets: dict, offline: bool = OFFLINE,
                 snapshot_file=SNAPSHOT_FILE, clock=time.time):
        self.assets = assets
        self.offline = offline
        self.snapshot_file = snapshot_file
        self.clock = clock
        self.lock = threading.RLock()
        self.prices: dict[str, dict] = {}
        self.fx: dict | None = None
        self.load_snapshot()

    # ---------- reading ----------

    def freshness(self, entry: dict) -> str:
        if entry.get("from_snapshot"):
            return "offline"
        age = self.clock() - entry["fetched_at"]
        return "live" if age <= LIVE_MAX_AGE_S else "delayed"

    def get(self, asset_id: str) -> dict | None:
        with self.lock:
            entry = deepcopy(self.prices.get(asset_id))
        if entry is None:
            return None
        return {**entry, "freshness": self.freshness(entry)}

    def get_all(self) -> dict[str, dict]:
        with self.lock:
            return {asset_id: self.get(asset_id) for asset_id in self.prices}

    def freeze(self):
        """Copy prices and FX together for a single model turn."""
        with self.lock:
            return deepcopy(self.prices), deepcopy(self.fx)

    # ---------- refreshing ----------

    def refresh(self) -> list[str]:
        with self.lock:
            return self._refresh()

    def _refresh(self) -> list[str]:
        """Poll every source once. Returns a list of problems (empty means all good)."""
        if self.offline:
            return ["offline mode: using snapshot only"]
        problems = []
        now = self.clock()

        try:
            self.fx = {**fetch_usd_thb(), "fetched_at": now}
        except (httpx.HTTPError, KeyError, ValueError) as e:
            problems.append(f"fx: {e}")
        if self.fx is None:
            return problems + ["no USD to THB rate yet, prices not updated"]
        rate = self.fx["rate"]

        by_symbol = {a["symbol"]: asset_id for asset_id, a in self.assets.items()
                     if a["source"] == "binance"}
        try:
            tickers = fetch_tickers(list(by_symbol))
        except (httpx.HTTPError, ValueError) as e:
            tickers = []
            problems.append(f"binance: {e}")

        for raw in tickers:
            asset_id = by_symbol[raw["symbol"]]
            try:
                entry = normalize_ticker(raw, asset_id, rate, now)
                check_jump(entry["price_usd"], self._recent_price(asset_id, now))
            except (BadPrice, KeyError, ValueError) as e:
                problems.append(f"{asset_id}: {e}")
                continue
            self.prices[asset_id] = entry

        problems += self._refresh_yahoo(rate, now)

        for asset_id, a in self.assets.items():
            if a["source"] == "fixed":
                self.prices[asset_id] = {
                    "asset_id": asset_id, "price_usd": a["price_usd"],
                    "price_thb": round(a["price_usd"] * rate, 2), "change_24h_pct": 0.0,
                    "as_of": self.fx["as_of"], "source": "fixed", "fetched_at": now,
                }

        self.save_snapshot()
        return problems

    def _refresh_yahoo(self, rate: float, now: float) -> list[str]:
        """Stocks and funds. Yahoo is a public endpoint with no guarantees, so ask at most once a minute per symbol, in parallel."""
        due = {asset_id: a for asset_id, a in self.assets.items() if a["source"] == "yahoo"
               and now - (self.prices.get(asset_id) or {}).get("fetched_at", 0) >= YAHOO_EVERY_S}
        if not due:
            return []

        def one(item):
            asset_id, a = item
            try:
                return asset_id, fetch_yahoo_chart(a["symbol"], "1d", "5d"), None
            except (httpx.HTTPError, ValueError) as e:
                return asset_id, None, e

        problems = []
        with ThreadPoolExecutor(max_workers=len(due)) as pool:
            for asset_id, chart, error in pool.map(one, due.items()):
                if error is not None:
                    problems.append(f"{asset_id}: {error}")
                    continue
                try:
                    entry = normalize_yahoo_quote(chart, asset_id, rate, now)
                    check_jump(entry["price_usd"], self._recent_price(asset_id, now))
                except (BadPrice, KeyError, ValueError, TypeError) as e:
                    problems.append(f"{asset_id}: {e}")
                    continue
                self.prices[asset_id] = entry
        return problems

    def _recent_price(self, asset_id: str, now: float) -> float | None:
        """Last accepted price, if it's recent enough to compare a jump against."""
        last = self.prices.get(asset_id)
        if last is None or last.get("from_snapshot"):
            return None
        if now - last["fetched_at"] > JUMP_CHECK_MAX_AGE_S:
            return None
        return last["price_usd"]

    # ---------- snapshot ----------

    def save_snapshot(self) -> None:
        live = {k: v for k, v in self.prices.items() if not v.get("from_snapshot")}
        if not live:
            return
        self.snapshot_file.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.snapshot_file.with_suffix(".tmp")
        tmp.write_text(json.dumps({"fx": self.fx, "prices": live}, indent=2))
        tmp.replace(self.snapshot_file)  # atomic, so a crash never leaves half a file

    def load_snapshot(self) -> None:
        if not self.snapshot_file.exists():
            return
        data = json.loads(self.snapshot_file.read_text())
        self.fx = data["fx"]
        self.prices = {k: {**v, "from_snapshot": True} for k, v in data["prices"].items()
                       if k in self.assets}
