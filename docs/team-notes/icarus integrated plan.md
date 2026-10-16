# Icarus integrated backend plan

Status: proposed v3, 15 October 2026. Combines `icarus context.md`, `message.txt`, and the pipeline discussion. This is a design document, not implemented functionality. Preserve the original files as reference. Team agreement and venue API access remain unconfirmed.

## 1. What carries forward

Build one backend with two outputs: an in-app assistant and a friction dashboard. Use synthetic accounts, live or explicitly delayed market data, reviewed app knowledge, deterministic calculation tools, and automatic event logging. Both the frontend and assistant consume the same backend values.

Keep the v2 stack proposal: Python, FastAPI, httpx, Pydantic, SQLite, and an in-process polling task. Run one application worker for the demo so polling is not duplicated. Pin dependencies. No model training or vector database is needed.

Keep the v2 tool list, API outline, repository layout, two seed users, and A/B work split, subject to the corrections below. Owner assignment is still open. These are work tracks for Luka and First, not a request to spawn coding agents.

Contract changes relative to the original context:
- `execute_trade` is a backend confirmation route, never an LLM tool.
- `log_friction` is automatic instrumentation, never dependent on the LLM remembering to log.
- Add `resolve_asset` and `explain_element`.
- Cards reference backend result objects by ID.
- Forward what-if ranges, stocks, and unlock alerts are deferred.

## 2. Revised priorities

P0, by hour 8: agreed contracts, stub chat, two synthetic accounts, BTC and one precisely named gold asset, price/history snapshots, selected-element explanation, a buy-only simulated preview/confirm flow, UI navigation/highlighting, conversation state, and structured events. All confirmations are taps.

P1a, by hour 14: friction summary, reliable reset, numerical answer validation, refusal and transaction tests, Thai/voice integration with KP, and an honest fallback rehearsal. These are required before adding more analytical features.

P1b, only after P1a: portfolio X-ray, comparison, goal math, historical what-if, ETH, and more journey hints. Add each feature only if its data definitions and tests are complete.

P2: stocks, SOL, unlock alerts, forward ranges, and gold-weight conversions. No new features in the final two hours.

## 3. Market pipeline and currency corrections

Candidate sources: Binance for supported spot pairs, CoinGecko as a fallback, and Frankfurter for daily reference FX. Probe actual asset support and access from the venue before committing. Binance still has IP-based request-weight limits; being keyless does not remove shared-IP risk.

Use a configurable polling interval, batched requests, bounded timeouts, backoff with jitter, and cooldowns after throttling. Serve cache immediately; never make a chat request wait on a fresh provider fetch. Persist snapshots atomically and validate them on load.

Important: BTCUSDT and PAXGUSDT prices are denominated in USDT, not USD. Either obtain a measured USDT/USD conversion, use a supported direct fiat pricing source, or explicitly label USDT=USD as a demo assumption. Never silently treat the two currencies as identical. Do not present a fixed USDT value as measured market data.

For derived THB prices, preserve every dependency: asset quote, quote currency, optional stablecoin conversion, FX reference date, provider, and retrieval time. Daily FX is a reference conversion, not a live executable exchange quote. Fetching it hourly does not make its underlying observation hourly.

Separate independent metadata:
- `origin`: market, synthetic account, or simulated execution.
- `delivery`: network, cache, or snapshot.
- `observed_at` and `retrieved_at`.
- `freshness`: fresh, delayed, or unavailable, evaluated per component.
- `valuation_id`: identifies the exact price/FX bundle used in a calculation or screen view.

This replaces the overloaded live/delayed/offline/simulated enum. A simulated portfolio may contain current market valuations and an offline snapshot may already be old. Each component needs its own metadata.

Pin a valuation bundle for each response/card and return that bundle to the frontend. Sharing a cache alone cannot prevent a screen and assistant from reading different polling updates. Show a valuation time and preserve the same chart endpoints when explaining a chart.

Replace the unconditional 20% rejection rule with an anomaly flag and, where available, a second-source check. Quarantine suspicious observations, serve labeled prior data, and log the reason. A large real move or provider change must not silently freeze a price forever.

## 4. History and statistics

Retain raw candles separately from downsampled chart points. Calculate statistics from raw history only. Three years of daily observations exceeds a single 1,000-candle request, so paginate and verify continuity. Use completed daily candles for daily statistics; keep a current live point distinct.

Declare UTC candle boundaries, percentage units, return definitions, and available coverage. Do not claim three years when the asset has less history. Calendar-month statistics use complete months and state the sample period.

Historical THB returns require historical FX and any relevant quote conversion. If those are unavailable, show returns in their actual quote currency with a clear label. Do not convert every historical point with today's FX and call the result historical THB performance.

Treat provider switches as changes in measurement basis. Preserve source per series and avoid silently stitching unlike histories. A Binance 24h quote-currency change is not automatically a THB return.

Define historical what-if as an explicit purchase date, available reference price, end date, and treatment of fees. Describe synthetic transactions priced from real history as hypothetical, not actual user performance.

## 5. Trade accounting and confirmation

P0 supports simulated buys only. Remove unsupported sell/swap options from the exposed tool schema until their accounting is implemented.

Define `amount_thb` as the total cash budget, including fees. Show investment amount, fee, total debit, quantity, unit price, and expiry separately. With the proposed mock minimum fee, a 1,000 THB total budget buys 995 THB of the asset and pays 5 THB in fees. If the team prefers fees on top, change this explicitly across UI, tools, and voice before implementation.

Specify the percentage-fee basis and minimum-buy basis in `fees.json`. Use Decimal or fixed-point arithmetic with explicit asset precision and THB rounding. Store seed quantities, transactions, and fee amounts deterministically.

Call the preview a simulated quote. An external ticker cannot guarantee a real execution price. A two-minute price lock is valid only inside this simulation.

On confirm, derive the user from the server session, then atomically check ownership, pending status, expiry, and current balance; update cash, holdings, ledger, and journey; and store the confirmation result. Check the balance again because multiple pending previews can otherwise overspend. Enforce uniqueness so repeat confirmation returns the first result.

An expired preview returns an expiry error and optionally a replacement preview. A replacement always requires a new tap. An old tap never authorizes changed terms. Cancellation invalidates a preview server-side. Voice never authenticates or confirms.

## 6. Assistant and frontend contracts still needed

Implement server-side conversation history keyed by session. Persist pending intent and selected preview so follow-ups such as "why that fee?", "make it 500", and "cancel" work. Changes create or invalidate previews explicitly. User identity comes from the session; model-supplied user IDs cannot select another account.

Add request and turn IDs, language, response status, result objects or authorized result-fetch links, structured errors, and schema version to chat replies. Result IDs alone are insufficient unless the frontend can retrieve their data. Scope result objects to the session and define their lifetime.

Define an error envelope: `code`, user-facing `message`, `retryable`, and `request_id`. Give chat/tool calls bounded timeouts and tool-call limits. Select the model/provider and assign ownership of assistant integration before coding.

Include screen revision in requests and UI actions. A late answer must not highlight an element on a screen the user has already left. Add a permitted `navigate` action, followed by a rendered-screen acknowledgement before highlighting. A registry entry alone does not mean an element is currently visible.

Oasis and KP need these shared fixtures: chart explanation, valid purchase preview, insufficient funds, expired quote, clarification, refusal, and provider outage. Export schemas from `contracts.py`.

Agree with KP on initial non-streaming or streaming delivery. Include cancellation IDs for voice interruption, so cancelled turns do not keep speaking or apply stale UI instructions. Backend cancellation and preview cancellation are separate actions.

## 7. Numerical and behavioral guardrails

Card values come directly from typed tool results. For key spoken amounts and explanatory comparisons, use backend-generated numerical phrases or templates. Copying strings into an LLM prompt is helpful but is not a guarantee.

Checking whether a number appears somewhere in a turn is insufficient: the model could swap balances and fees, reverse a return, or copy an unverified figure from the user. Validate claim-to-field association, units, signs, rounding, and dates. User-entered targets and budgets are inputs, not evidence for market facts.

Advice prevention needs behavior tests as well as tool schemas. Removing verdict fields does not prevent the model from recommending an asset in prose. Treat user text and retrieved descriptions as untrusted content, and permit only registered tools and UI actions.

Goal math needs a defined contribution schedule, not merely full months rounded to at least one. State whether the first contribution is today or next month, handle deadlines within a month, and return zero when the target is already met. Document the no-interest assumption.

Define portfolio allocation denominator, cost-basis method, treatment of fees, and realized versus unrealized gains before implementing X-ray. Historical risk describes the observed sample, not a bound on future losses.

## 8. Friction events and measurement

Separate `preview_created` (backend) from `preview_shown` (frontend render acknowledgement). A tool call cannot establish that a user saw a card.

Assign stable task IDs across chat and manual navigation. Attach a unique event ID; deduplicate ingestion. Use server receipt times and preserve client occurrence times for duration calculations. Emit authoritative purchase completion from the backend.

Make chat versus frontend ownership of each help event explicit to avoid double counting. Include error reason, experiment condition, origin (real test or synthetic), and event schema version.

Define each dashboard denominator: distinct tasks, distinct sessions, or distinct users. Define repeat-question windows and the completion-after-help window. Keep synthetic fallback events excluded from real metrics by default.

A keyword match is an inferred confusion signal, including Thai matches. Mark it accordingly. Track inactivity abandonment separately from confirmed cancellation; reconcile an inferred abandonment if the task later completes. Chat activity and navigation refresh task activity.

For the friction test, record task condition and order. Let some participants try assisted first and others manual first, or use comparable tasks. Repeating the same task in one fixed order creates a learning effect. Show individual times and small-sample counts; do not claim causal uplift from the stage stopwatch alone.

Default analytics to structured topics. Removing names and numbers alone is not sufficient transcript redaction. Keep raw question/audio retention off by default; if examples are collected, use reviewed or explicitly consented excerpts and define deletion.

## 9. Runtime, reset, and offline behavior

Choose the backend host and agree the base URL, CORS origins, session setup, and environment-variable names. Keep provider keys server-side. Protect reset and business-summary routes with demo/admin access. Do not connect this hackathon build to real trading accounts.

Add session creation, preview cancellation, result retrieval (unless replies embed results), and permitted asset/registry discovery to the v2 endpoint list as needed by the agreed contract. Manual purchase screens must use the same quote/confirm backend as the assistant path.

Separate account reset from analytics reset. Rehearsal reset must not erase outsider-test results. Seed loading is idempotent and must not overwrite accounts or events on every restart. Reset clears pending previews and conversation state; retain or archive analytics according to the selected mode.

Health reports market, FX, history, LLM, and voice dependencies separately. Record latency, tool failures, rejected data, and fallback usage without logging credentials or full personal transcripts. Measure text response latency separately from completed voice output.

Cached prices do not make a hosted LLM, STT, or TTS work offline. Provide an explicit fallback matrix:
- Market outage: labeled cached/snapshot data, subject to quote policy.
- LLM outage: limited deterministic scripted demo flows, labeled fallback.
- STT/TTS outage: typed input and text output, plus recorded demonstration audio/video if needed.
- Full network outage: local frontend/backend, snapshots, and scripted flow or recorded demo.

Distinguish a forced snapshot mode from a full no-network mode. Freshness checks still apply to snapshots. If a full no-network simulation permits old prices, make that a separate visible demo policy; do not bypass stale-price checks silently.

## 10. Completion gates

Hour 2: owners assigned; model/key and backend host chosen; venue source probes completed; schemas and mock replies shared with Oasis and KP; fee semantics agreed.

Hour 8: both manual and assistant purchase flows use the same accounting; chart explanations match displayed valuation bundles; duplicate taps, multiple previews, insufficient funds, stale quotes, and quote expiry behave correctly; event ingestion works.

Hour 14: dashboard uses real deduplicated events; conversation follow-ups work; refusal/numerical checks pass; Thai integration checked; account reset preserves collected analytics; fallback modes rehearsed. Only then add P1b.

Before demos: three uninterrupted full runs, one dependency-failure run, and the exact stage lines checked against sources. Test USDT conversion, historical FX, calendar boundaries, swapped numeric fields, and late UI actions as applicable to implemented features.

## 11. Verified documentation and remaining checks

Binance documents a maximum of 1,000 klines per request, UTC interpretation of start/end timestamps, and endpoint request weights: https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md

Binance documents IP-level used-weight headers: https://developers.binance.info/en/docs/products/spot/rest-api

Frankfurter currently documents v2 and identifies v1 as deprecated but available. Use a documented versioned endpoint and verify USD/THB coverage and the selected provider during the venue probe: https://frankfurter.dev/

Unconfirmed: U-topia integration access, actual asset/token mapping, real fee rules, venue API reachability, model/provider limits, deployment host, Thai quality, and team ownership. These remain checks, not assumed facts.
