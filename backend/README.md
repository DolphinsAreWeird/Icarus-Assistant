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

Icarus moves around Oasis's prototype with a **closed set of actions**. `app/ui.py` checks every
action before it leaves the backend. There is **no confirm action**: the user taps Confirm on the card.

`navigate · back · open_asset · set_period · set_filter · toggle_freeze · hide_balance · highlight · start_guide · card`

Most are the prototype's own actions, in its exact format. `highlight` uses `element_id` and `card`
carries our trade preview, as the team contract and `frontend/src/backend-bridge.ts` expect.
We don't send the prototype's buy-screen actions: its buy screen adds its own fee, so buys go on
our card with our numbers (INTEGRATION.md, point 1).

The model never writes these directly. It picks an **intent** (a tool), and code turns it into the
right sequence for the screen the user is on:

| Intent tool | Example request | From the Home screen it sends |
|---|---|---|
| `go_to_screen` | "take me to my card" | `navigate` |
| `go_back` | "go back" | `back` |
| `show_asset` | "show me gold over a year" | `open_asset`, `set_period` |
| `change_chart_period` | "switch to one week" | `navigate` (Invest), `set_period` |
| `filter_assets` | "only crypto" | `set_filter` |
| `prepare_trade` | "put 1,000 baht in gold" | `open_asset`, `card` (our preview; tap Confirm on it) |
| `cancel_trade` | "cancel that" | nothing on screen; the open preview can no longer be confirmed |
| `guide_me` | "walk me through buying bitcoin" | `start_guide` (always alone) |
| `set_card_frozen` | "freeze my card" | `toggle_freeze` |
| `set_balances_hidden` | "hide my balance" | `navigate`, `hide_balance` |
| `highlight_element` | "where is my balance?" | `navigate`, `highlight` |
| `show_chart` | "how did bitcoin do this year?", "compare bitcoin and gold" | `card` (chart, in baht; % when comparing). On that asset's own page it switches the real chart instead |
| `show_steps` | "how do I buy?" | `card` (steps from `data/howto.json`; each step can point at its element) |

**Chat cards.** At most one card per reply (a trade preview beats a chart beats steps). When a chart or
steps card is shown, only the first sentence of the reply is kept: the card has the details, and the
voice says just the headline.

**Everything is in baht.** Tools give exact numbers plus a `say` version ("about 3.6 million baht",
"down about 24%", from `app/display.py`), so replies stay short and easy to hear.
`GET /market` gives the app live baht prices and period changes, keyed by the app's asset ids.

Plus `explain_element` (explains and highlights) and the data tools. The app's ids live in
`data/app_ui.json`, a read-only mirror of the prototype. Tests read the prototype and the bridge
and fail if either stops supporting something we send.

`POST /chat` accepts the bridge's request (`screen_context`, lowercase ids and periods), the voice
server's (`{text, language, snapshot, userId}`), and ours. `userId: "demo-user"` maps to `DEMO_USER`
(default `u_new`).
