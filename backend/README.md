# Icarus backend

Owners: Luka and First. Plan: [../plan-data-pipeline.md](../plan-data-pipeline.md).

## Setup

```
cd backend
uv venv .venv && uv pip install -p .venv/bin/python -r requirements.txt
```

## Data acquisition

```
.venv/bin/python -m scripts.fetch_market --history   # FX + 3y daily + 7d hourly history, prices once
.venv/bin/python -m scripts.fetch_market --loop      # poll prices every 15 s
.venv/bin/python -m scripts.make_users --anchor 2026-10-15   # rebuild the 2 demo users
OFFLINE=1 .venv/bin/python -m scripts.fetch_market   # no network, snapshot only
.venv/bin/python -m pytest -q
```

| What | Where | Source |
|---|---|---|
| Live prices + USD->THB | `data/snapshots/prices.json` | Binance 24h ticker, Frankfurter (backup: open.er-api.com) |
| Price history | `data/snapshots/history/<asset>_<1d or 1h>.json` | Binance klines, each day converted at that day's FX rate |
| FX history | `data/snapshots/fx_history.json` | Frankfurter |
| Assets, fees, glossary, UI elements, journey | `data/*.json` | written by hand. `reviewed: false` = not checked yet |
| Demo users | `data/seed/u_new.json`, `u_small.json` | `scripts/make_users.py`, real prices on each trade day |

Freshness of every price: `live` (under 2 min), `delayed` (last good value), `offline` (from the snapshot file).

Mocked, say so on stage: fee schedule (`fees.json`), both users. Binance quotes in USDT; we treat 1 USDT as 1 USD.
