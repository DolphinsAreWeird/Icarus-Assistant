# Backend serving the model branch

Baseline: `assistant-model` at `16ba286`. The original checkout's unfinished model edits are intentionally excluded. Backend changes live on branch `backend` in an isolated worktree.

## Serving boundary

FastAPI owns request validation, demo account selection, session isolation, data assembly, lifecycle and HTTP errors. `model/session.py` owns conversation/profile reasoning; `model/data_adapter.py` validates a frozen bundle for each turn. Keep model code unchanged so the model branch can evolve independently.

`POST /chat` defaults to the model integration. An explicit legacy engine remains available for the original navigation/trade assistant. Existing market, portfolio, history and simulated confirmation routes remain compatible. The new model cannot execute or prepare trades.

Responses preserve the existing text/speak/ui_actions/sources envelope and add status, limitations, disclaimer, deterministic numerical summaries and raw evidence. Text includes summaries and limitations because existing consumers only render text. Source metadata remains available in full. Do not expose model memory or profile provenance in debug output.

## Trust and freshness

This is a local demo, with fictional seed accounts and profiles; user IDs are selectors, not authentication. Never accept client-supplied account valuations or price provenance as trusted backend evidence. Prices come from the backend cache. Binance's legacy price_usd field is actually a USDT quote; expose it as USDT. THB values are the existing approximate conversion (USDT assumed equal to USD), labeled explicitly, using the older ticker/FX observation time. Gold is the PAXG proxy. Disk observations remain snapshots.

Accounts include cash and all supported nonzero holdings, valued with Decimal and rounded to cents. If any holding lacks a supported valuation, omit the entire account rather than report an understated total. Account evidence is synthetic and carries the oldest valuation timestamp.

The current frontend sends chart endpoints, not exact points and revisions. Chart explanations must remain unavailable until a versioned displayed-chart contract is integrated. Do not silently substitute backend history. Client snapshots remain UI context only.

## Concurrency and operation

Bound sessions by (demo user, session ID), with TTL, capacity, and per-session serialization. Reject saturation without evicting active conversations. Reset clears model sessions. A single process owns demo state; multiple workers are unsupported until a shared state store is chosen. Polling shuts down with the app and cache snapshots are copied under a lock.

Offline model mode is the default until explicitly enabled; market offline mode is a separate setting. No live model request is needed for deterministic endpoint tests. Bind the development server to loopback and allow configured local frontend origins.

## Deferred decisions

Authentication/account provider; durable state and retention; hosting and gateway credentials; production rate limits and observability; exact frontend chart revisions/points; approval of the THB proxy conversion and fictional profile/fee policies. These do not block a local, tested integration.
