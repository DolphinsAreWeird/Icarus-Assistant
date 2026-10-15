# Icarus: resolved data pipeline scope

15 October 2026. Selected implementation defaults for Luka/First's pipeline. Supersedes conflicting pipeline proposals in `message.txt` and `icarus integrated plan.md`. These decisions are a plan, not completed implementation or tested API access.

## Scope

Own ingestion, normalized market data, reviewed knowledge, synthetic account data, deterministic calculations, provenance, event storage/aggregation, and the data contracts consumed by other components. Supply quote/accounting data and a backend confirmation boundary for the simulation.

Frontend rendering, voice services, LLM selection/orchestration, hosting other components, and experiment recruitment are outside this plan. They only need to implement the interfaces below. No team-wide decisions are required to start pipeline work.

## Selected decisions

| Area | Decision |
|---|---|
| Runtime | Python + FastAPI + Pydantic + httpx + SQLite. One worker and one poller for the demo. Pin dependency versions when scaffolding. |
| Market provider | CoinGecko Demo API, one provider for current and historical prices. |
| Currency | Request THB directly. Optional USD values are separately labeled. No Binance USDT/USD approximation and no separate FX pipeline in the MVP. |
| Assets | Internal `btc` maps to `bitcoin`; internal `gold` maps to `pax-gold`. Label gold as PAX Gold, a tokenized asset. Verify mapping and available history in the initial probe. ETH is optional. |
| Integration assumption | Standalone simulated app with mock fees. U-topia access is not a dependency. |
| Current refresh | One batched request every 60 seconds, independent of users/chat requests. About 1,440 scheduled price calls per day, before history and retries. |
| History | Cache separate 1-day, 7-day, 30-day, and 365-day THB series per asset. Initial load only for missing/stale series. Refresh 1-day hourly, 7/30-day every six hours, 365-day daily. |
| Coverage | At most the past 365 days, limited further by actual asset availability. Remove three-year claims and statistics. |
| Backup | Last valid persisted data, then a bundled timestamped snapshot. No second live provider in the MVP. |
| Freshness | Fresh when the provider observation is at most 120 seconds old; delayed thereafter. Missing/invalid timestamp is not fresh. Cached data is not automatically fresh. |
| Quotes | Simulation only. Normal mode requires fresh price data. An explicit snapshot-demo mode allows old prices only with visible snapshot and simulation labels. |
| Money math | Decimal arithmetic, currency amounts represented as decimal strings at API boundaries. THB rounded to two decimals; asset quantities rounded down to configured precision. Preserve any residual cash. |
| Purchase amount | `budget_thb` means maximum total debit including fees. Fee = max(0.25% of budget, 5 THB), rounded to satang. Minimum budget 100 THB. All are mock app rules. |
| Simulation | Buy only. Immutable preview, expires after 120 seconds; confirmation through the backend route only. No sell/swap schema until implemented. |
| Analytics | Structured events by default, no raw chat/audio. Server events are authoritative for financial state. Synthetic data excluded from real metrics by default. |
| Reset | Account/conversation integration reset and analytics deletion are separate operations. Account reset invalidates pending previews and preserves test analytics. |

CoinGecko documentation supports batched price lookup, observation timestamps, target currencies, and historical series. Demo historical access is restricted to 365 days. Provider-returned THB history is treated as that provider's reference series, not independently audited FX or an executable trading quote.

## Data flow

Provider -> validated raw response -> normalized immutable price/history versions -> SQLite and atomic snapshot export -> in-memory latest pointers -> data API and calculation tools.

Reviewed JSON -> schema validation -> versioned asset/glossary/UI knowledge -> explanation payloads.

Synthetic seed -> cash/holdings/ledger -> quote and portfolio calculations using one valuation bundle.

Frontend/backend events -> validation and deduplication -> event store -> task summaries -> dashboard aggregates.

## Storage and validation

Tables: `price_observations`, `history_series`, `valuation_bundles`, `users`, `holdings`, `transactions`, `trade_previews`, `events`, and `tasks`. Keep raw history separate from downsampled display points. Keep seed fixtures separate from the runtime database.

Every observation carries `asset_id`, `currency`, decimal value, `observed_at`, `retrieved_at`, `provider`, and schema version. Every derived result includes `result_id`, `valuation_id`, component references, computation version, and applicable knowledge/fee version. Expose account origin, execution simulation, data delivery mode, and freshness independently.

Reject non-finite/non-positive prices, unknown assets/currencies, implausible timestamps, and malformed series. Sort and deduplicate history timestamps. A move exceeding 20% from the previous observation triggers quarantine and a follow-up fetch; do not silently accept it or overwrite the good cache. Persistent anomalies remain visible in health diagnostics and require explicit review. Store valid assets even if another asset in a batch fails validation.

Use bounded request timeouts, rate-limit-aware backoff, and retry budgets. Do not retry repeatedly inside chat requests. Write snapshot files via a temporary file and atomic replacement. Never commit API keys or runtime user data.

Each valuation bundle freezes the exact price observations used together. Consumers can request that bundle again instead of reading a newer polling update. Keep bundles referenced by active previews and calculations; prune only unreferenced expired records. Result objects expire after one hour unless referenced by a retained transaction or diagnostic fixture.

## Deterministic outputs

- Prices: THB value, provider 24h THB change when supplied, timestamps, and labels. Missing change stays unavailable, never zero.
- History: range, actual coverage, granularity, timezone, source version, and points. Return unavailable rather than fabricate missing coverage.
- Statistics: observed-period change, median absolute daily change, best/worst complete calendar month, and maximum drawdown within available history. Use only daily historical samples, exclude partial-day values, and state coverage. These are sampled price statistics, not intraday extremes.
- What-if: historical hypothetical quantity and end value using explicit reference dates and a disclosed fee policy. No forward ranges.
- Portfolio: cash and holdings valued from one bundle. Allocation includes cash in the total; report asset-only allocation separately if requested. Weighted-average cost basis includes purchase fees; realized gains are out of scope for buy-only MVP. Synthetic trades remain hypothetical even when reference prices are real.
- Goal math: no interest, first contribution today, subsequent contributions on monthly anniversaries up to and including the deadline, clamping to month end. Round required contribution upward to satang. Target already met returns zero; past deadline returns a structured error.
- Explanation data: reviewed description, selected chart range/endpoints or field value, source references, and ready-to-render numerical phrases. The assistant owns final prose but must preserve the references and units.

## Interfaces to other systems

All contracts are versioned Pydantic schemas exported as OpenAPI/JSON Schema. Pipeline identity is resolved from a backend session, not an arbitrary model-supplied user ID. For the demo, explicitly created sessions bind to one of the two permitted synthetic profiles; this is not production authentication.

| Consumer | Pipeline provides | Consumer must provide/do |
|---|---|---|
| Frontend | `GET /assets`, `GET /prices`, `GET /history/{asset}`, `GET /portfolio`, `GET /results/{id}`; valuation IDs and labels | Display returned values/labels; include valuation/history version when asking about displayed data. |
| Assistant owner | Typed functions for prices, history, asset info, element explanation, portfolio, compare, goal math, what-if, asset resolution, prepare/cancel preview | Provide session, asset/element references, normalized inputs; preserve numeric field meaning. LLM selection and conversation memory stay outside pipeline. |
| Purchase UI | `POST /previews`, `POST /previews/{id}/cancel`, `POST /previews/{id}/confirm` | Call confirm only after a tap; show exact preview terms and expiry. Manual and assisted flows use the same routes. |
| Oasis's UI registry | Versioned registry loader and element explanation function | Supply `element_id`, screen, meaning/data binding; provide selected asset, chart period, displayed version, focused element. Navigation/highlight implementation stays outside pipeline. |
| KP's voice integration | Typed numeric fields and optional preformatted phrases with units and language tags | Send finalized input through the assistant contract; use backend values for spoken amounts. No direct confirmation from voice. STT/TTS stays outside pipeline. |
| Frontend and assistant event emitters | `POST /events` with deduplication and validation | Send stable event, session, task, and request IDs; screen/element; language/input mode; test condition; and origin. No transcripts required. |
| Business dashboard | `GET /friction/summary` with filters, counts, denominators, metric version, and real/synthetic separation | Render returned aggregates and labels. Dashboard design stays outside pipeline. |
| Integrators | `/health` with source, cache, history coverage, freshness, and last errors; backend base URL through configuration | Configure API URL and allowed origins. LLM and voice health are owned by their systems. |

Preview responses include budget, fee, investment amount, quantity, rounding remainder, actual total debit, THB unit price, valuation ID, expiry, mode labels, and status. Confirmation rechecks ownership, status, expiry, and balance inside the same SQLite transaction as cash/holdings/ledger updates. Multiple previews cannot overspend. Duplicate confirmation returns the stored original result. Replacement previews require a new tap.

Error envelope: `code`, `message`, `retryable`, `request_id`, and optional field errors. Core codes: `UNKNOWN_ASSET`, `DATA_UNAVAILABLE`, `PRICE_STALE`, `INVALID_AMOUNT`, `INSUFFICIENT_FUNDS`, `PREVIEW_EXPIRED`, `PREVIEW_CANCELLED`, `SESSION_INVALID`, and `VERSION_UNAVAILABLE`.

## Events and metrics

Frontend owns `task_started`, `screen_viewed`, `preview_shown`, and explicit task cancellation. Backend owns `preview_created`, `validation_failed`, and `task_completed`. Assistant integration owns `help_requested`, inferred confusion, and refusal. One owner per event avoids double counting.

Event ingestion uses unique `event_id`; identical retries return success and conflicting reuse returns an error. Store server receipt time separately from client occurrence time. A task is identified by `task_id`, not reconstructed from arbitrary chat turns. Keep manual/assisted condition explicit; help can occur midway through either condition.

Summary definitions:
- Funnel denominators: distinct started tasks in the selected cohort; stages count tasks at most once. Use frontend acknowledgement for shown previews.
- Completion time: first task start to authoritative completion, only for completed tasks; return sample count and median.
- Completion after help: tasks with help that subsequently complete within ten minutes, divided by tasks with help whose window has closed or which already completed. Show unresolved tasks separately.
- Repeat topic: a second or later help request on the same topic in the same task.
- Inactivity: after 120 seconds without activity, mark an inferred inactive state. Later activity/completion reopens/reconciles it; it is not an irreversible failure.
- Counts by language and screen; explicitly separate unknown topics from classified topics. Keyword-based confusion is always inferred.

## Build order and acceptance

1. Schemas, fixtures, seed data, fee config, registry stub, and documented consumer examples.
2. CoinGecko adapter and initial support probe; normalized stores, cache, snapshots, health.
3. Price/history endpoints and pinned calculation/result bundles.
4. Synthetic portfolio, simulated previews and atomic confirmation.
5. Event ingestion and friction summaries.
6. Optional analytical tools after the complete core path passes.

Acceptance: known-fixture arithmetic; current and historical THB labels; malformed/missing data handling; deterministic snapshots; outage fallback; stale quote rejection; explicit snapshot simulation; duplicate and competing confirmation; result ownership; event deduplication; late-completion reconciliation; analytics-preserving account reset. Provide JSON fixtures so other systems can integrate before their implementation is ready.

## External dependencies that remain factual checks

The defaults above are settled for this pipeline. Implementation still needs a working CoinGecko Demo key, an actual request confirming THB and asset coverage from the execution network, and Oasis's final registry mapping. These are credentials/access/input checks, not unresolved architecture. Use timestamped fixtures until available; never label unverified fixtures as live.

Sources checked 15 October 2026:
- https://docs.coingecko.com/demo/reference/simple-price
- https://docs.coingecko.com/demo/reference/coins-id-market-chart
- https://www.coingecko.com/en/api/pricing
