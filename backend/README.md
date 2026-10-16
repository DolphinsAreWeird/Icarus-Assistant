# Icarus backend

## Model branch integration (default)

This backend serves `model/session.py` through `POST /chat`, with focused demo commands mapped to the existing checked navigation, chart, guide and simulated trade-preview tools. The original assistant is available with `ASSISTANT_ENGINE=legacy`. Only an explicit confirmation tap changes the demo account. See [DEMO_HANDOFF.md](DEMO_HANDOFF.md) for the current demo runbook and comparison with main.

Windows quick start from this worktree:

```powershell
cd D:\Uhackathon\.worktrees\backend\backend
python -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
Copy-Item .env.example .env
.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

The example configuration serves saved market observations and offline retrieval previews. `/fee 1000`, `/prices THB btc gold`, `/prices USDT btc eth`, `/portfolio`, `/set goal retirement`, and `/profile` use deterministic model paths without gateway calls. Focused app commands also work offline. Ordinary offline questions return a labeled knowledge retrieval preview. The connected frontend now supplies chart revisions and display versions; `/chart` and the chart-help button resolve the exact server-owned displayed series. A missing or outdated version returns unavailable.

```powershell
Invoke-RestMethod http://127.0.0.1:8000/chat -Method Post -ContentType application/json -Body '{"session_id":"demo-1","user_id":"u_small","text":"/prices THB btc gold","lang":"en"}'
```

For gateway reasoning, set `ICARUS_MODEL_OFFLINE=0`, `ICARUS_LLM_BASE_URL`, `ICARUS_LLM_MODEL`, and `ICARUS_LLM_API_KEY` in the ignored `backend/.env`. The model also supports its own ignored `model/.env`; process/backend settings take precedence. No key is needed for the offline paths. Market network access is controlled separately by `OFFLINE`.

Open the existing frontend at `http://localhost:8787/app/?backend&user=u_small`. The backend allows the local frontend origins on ports 8787, 5173 and 3000 by default; use `CORS_ORIGINS` for an explicit comma-separated override.

The reply retains `text`, `speak`, `ui_actions`, `sources`, `debug` and adds `speech`, `speech_exact`, `status`, `numerical_summaries`, `limitations`, `disclaimer`, `evidence`, `emotion`, and `suggestions`. `text` includes summaries and caveats. `speech` selects a concise verified script; the existing voice service preserves exact numerical values when `speech_exact` is true. Full source origin, observation times, currency and delivery labels are in `evidence`.

Sessions are isolated by demo user and session ID, expire after 30 idle minutes, and are capped at 128. A busy conversation or a full session store returns a structured HTTP 429; reset during an active model turn returns 409. `/demo/reset` clears both demo accounts and model conversations. This is single-process, in-memory demo state: run one worker, on loopback. User IDs are demo selectors and provide no authentication.

THB reference prices retain the existing approximate conversion (USDT assumed equal to USD), explicitly labeled with the oldest ticker/FX timestamp. THB 24-hour change is omitted because the cache does not supply the corresponding historical FX conversion. Gold uses PAXG. Account values are fictional, include cash and use server prices; client-supplied money and provenance are never promoted to trusted evidence. See [DESIGN.md](DESIGN.md) for decisions and deferred integration questions.

Verification:

```powershell
# from backend/; create the parent once so pytest can use a writable temp location
New-Item -ItemType Directory -Force .test-tmp
python -m pytest -q --basetemp=.test-tmp/run
# from repository root
python -m unittest discover -s model/tests -q
```

The sections below describe the existing market pipeline and the optional legacy assistant.

Owners: Luka and First. Plan: [docs/team-notes/plan-data-pipeline.md](../docs/team-notes/plan-data-pipeline.md).

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

## Proactive help: `POST /nudge`

When a user is stuck, Icarus speaks up first. The app measures the idle time (15 s) and asks
`POST /nudge {user_id, lang?, snapshot, idle_s}`; the answer is `{"nudge": null}` or
`{reason, text, highlight, suggestions}`. It is **rules only, no model** (`app/nudge.py`): instant, works offline and
on either engine, and cannot invent a number or give advice. Wording is reviewed English and Thai templates; the only
numbers are the buy minimum and the user's cash.

Rules (first match wins): frozen card · wrong wallet · below the minimum · more than the cash · empty amount · ready to
review · waiting on review · Payments dead end · Card. Other screens get nothing. There is no KYC nudge because the app
has no KYC screen: add a rule keyed on its screen name in `app/nudge.py` when it exists. Tests: `tests/test_nudge.py`.

## Plain questions, and the friction map

**Plain questions** are answered instantly from data, in baht, in English and Thai, with no model call (`app/insights.py`, the
tools in `app/tools.py`, the triggers in `app/demo_intents.py`). They describe the past or do arithmetic; none predicts or advises.

| Ask | Tool | What you get |
|---|---|---|
| "what's the price of bitcoin", "ราคาทอง" | `tell_price` | live price in baht and the 24h change |
| "how much cash do I have", "how is my money split" | `get_balance` | cash, portfolio value, shares, fees this month |
| "how risky is bitcoin" | `get_risk` | usual daily move, worst month, biggest fall (3 years of history) |
| "what if I had put 1,000 baht in gold a year ago" | `what_if` | what it would be worth now. Past result, fees excluded |
| "to save 50,000 baht by June" | `goal_math` | the monthly amount, rounded up so the goal is met. No interest |

An asset with no data (Apple, Tesla) gets an honest "I don't have that yet". The same tools are offered to the legacy engine's model.
The history needs `model/data/market/`: run `python model/prepare_market_data.py --assets btc eth gold --start 2024-01 --end 2026-09` once.

**The friction map** (`app/friction.py`). The backend logs on its own: every question (by *topic*, never the text), confusion
("what does X mean"), refusals, questions it couldn't answer, previews and completed purchases, and nudges issued. The app can add
its own with `POST /events` (`task_started`, `task_abandoned`, `screen_view`, `help_requested`, `tap_explain`, `nudge_shown`).
`GET /friction/summary` returns the top questions and confusing terms with denominators ("3 of 10 users asked about fee"), counts by
screen, the purchase funnel, refusals and the unanswered count. Users are a short hash of the id. In memory (5,000 events);
`FRICTION_LOG_FILE=path` also appends to a file; `POST /friction/reset` clears it.
