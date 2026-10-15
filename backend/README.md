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

## The assistant (minimal version)

Runs on a local model through Ollama: free, offline, about 1 to 3 s per answer on an M3 Max.

One-time setup (about 18 GB download, needs about 19 GB of free memory while running):

```
ollama pull hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:UD-Q4_K_XL
ollama create icarus -f ollama/Modelfile      # same weights, 16k context instead of 262k
```

The first question after a restart takes about 30 s while the model loads. After that it stays loaded for 2 hours.
Other OpenAI-compatible providers still work if we need them: `LLM_PROVIDER=groq` + `GROQ_API_KEY`,
or `LLM_PROVIDER=gemini` + `GEMINI_API_KEY`. `LLM_MODEL` overrides the model.

```
.venv/bin/uvicorn app.main:app --port 8000         # API, docs at http://localhost:8000/docs (OFFLINE=1 for snapshot only)
.venv/bin/python -m scripts.chat --user u_new --screen asset_detail --asset gold --period 1m --focus asset.chart
```

| Endpoint | What |
|---|---|
| `POST /chat` | `{session_id, user_id, text, lang?, input_mode?, screen_context?}` -> `{text, speak, ui_actions, sources, debug}` |
| `POST /trades/{preview_id}/confirm` | `{user_id}`. The only way a trade happens. Safe to call twice |
| `GET /prices?ids=btc,gold`, `GET /history/{id}?period=1d/1w/1m/1y`, `GET /portfolio/{user_id}` | same data the tools use |
| `POST /demo/reset`, `GET /health` | |
