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

## Navigating the app (UI actions)

Icarus drives Oasis's prototype with a **closed set of 14 actions**, the ones the prototype's
`doAction` runs, in its exact format. `app/ui.py` checks every action before it leaves the backend.
There is **no confirm action**: the user taps Confirm purchase.

`navigate · back · open_asset · set_period · set_filter · start_buy · type_amount · select_wallet · review · cancel_buy · toggle_freeze · hide_balance · highlight · start_guide`

The model never writes these directly. It picks one of **11 intents** (tools), and code turns the
intent into the right sequence for the screen the user is on:

| Intent tool | Example request | From the Home screen it sends |
|---|---|---|
| `go_to_screen` | "take me to my card" | `navigate` |
| `go_back` | "go back" | `back` |
| `show_asset` | "show me gold over a year" | `open_asset`, `set_period` |
| `change_chart_period` | "switch to one week" | `navigate` (Invest), `set_period` |
| `filter_assets` | "only crypto" | `set_filter` |
| `prepare_buy` | "put 1,000 baht in gold" | `open_asset`, `start_buy`, `type_amount`, `select_wallet`, `review` (stops at Confirm) |
| `cancel_buy` | "cancel that" | `cancel_buy` (only if a buy is open) |
| `guide_me` | "walk me through buying bitcoin" | `start_guide` (always alone) |
| `set_card_frozen` | "freeze my card" | `toggle_freeze` |
| `set_balances_hidden` | "hide my balance" | `hide_balance` |
| `highlight_element` | "where is my balance?" | `navigate`, `highlight` |

Plus `explain_element` (explains and highlights) and the data tools. The app's ids live in
`data/app_ui.json`, a read-only mirror of the prototype. Two tests read the prototype file and fail
if it stops supporting an action or element id we use.

`POST /chat` also accepts the voice server's shape: `{text, language, snapshot, userId}`, where
`snapshot` is the prototype's `getContext()`. `userId: "demo-user"` maps to `DEMO_USER` (default `u_new`).
