"""Fetch market data and save snapshots.

Run from backend/:
  python -m scripts.fetch_market             # prices once
  python -m scripts.fetch_market --history   # also FX history + price history
  python -m scripts.fetch_market --loop      # keep polling prices every 15 s
"""
import argparse
import sys
import time

from app import knowledge
from app.config import POLL_INTERVAL_S
from app.market.cache import PriceCache
from app.market.history import download_fx_history, download_history


def print_prices(cache: PriceCache) -> None:
    fx = cache.fx or {}
    print(f"USD->THB {fx.get('rate')} ({fx.get('source')}, {fx.get('as_of')})")
    for asset_id, p in cache.get_all().items():
        print(f"  {asset_id:5} {p['price_thb']:>14,.2f} THB  {p['change_24h_pct']:+6.2f}%  "
              f"{p['freshness']:8} {p['source']}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--history", action="store_true")
    parser.add_argument("--loop", action="store_true")
    args = parser.parse_args()

    problems = knowledge.validate_knowledge(knowledge.assets(), knowledge.glossary(),
                                            knowledge.ui_elements(), knowledge.journey())
    if problems:
        print("Knowledge files have problems:", *problems, sep="\n  ")
        return 1

    assets = knowledge.assets()
    cache = PriceCache(assets)

    if args.history:
        fx = download_fx_history()
        print(f"FX history: {len(fx)} business days")
        for asset_id, asset in assets.items():
            print(f"History {asset_id}: {download_history(asset_id, asset, fx)}")

    while True:
        for problem in cache.refresh():
            print("WARN", problem)
        print_prices(cache)
        if not args.loop:
            return 0
        time.sleep(POLL_INTERVAL_S)


if __name__ == "__main__":
    sys.exit(main())
