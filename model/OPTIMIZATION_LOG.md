# Optimization checkpoints

Human wording/financial review is deferred. These checkpoints record engineering checks, not expert approval. Backend, frontend and transaction execution are outside this work.

## User-input grounding

Model-selected monetary arguments must match explicit currency-bound user inputs, or an explicitly referenced saved budget. New bare amounts cannot silently inherit an older currency. Prefix currencies, grouped numbers and unspaced Thai input are recognized; negative amounts are rejected rather than reinterpreted as positive. Savings target/current values require matching role labels. Historical what-if dates and assets must match the current request or explicit recent context.

All 68 automated tests passed at this checkpoint. Six live numeric scenarios passed tool-name and exact-tool-field checks in English and Thai: prefixed/unspaced budgets, savings roles and ETH historical what-if dates. Model-turn median was 15.9245 seconds; maximum was 30.189 seconds. This is one run and demonstrates correctness of those cases, not acceptable universal voice latency.

```powershell
python model/evaluate_assistant.py --live --suite numeric --limit 6
```

Natural-language goal calculations now need explicitly labeled target/current amounts and an ISO deadline; `/goal` remains the direct typed interface. Missing or ambiguous inputs produce a tool error for clarification. Broader natural-language parsing remains deliberately conservative.

## Data and provider reliability

Every historical-data consumer now checks asset identity, quote currency, canonical daily dates, missing/duplicate days, coverage endpoints and finite valid candle values. Supported price bounds are internal input guards, not predictions of market limits. Saved forecasts are checked before rendering. Malformed provider envelopes and unreadable local files return explicit fallbacks/data errors instead of crashing.

Market ingestion only publishes an asset when the full requested month range is available and valid. Failed refreshes preserve that asset's existing series and exit with a failure report. Each newly published series retains its archive hashes/URLs. Writes use a temporary file in the destination directory and atomic replacement; a failed serialization or replacement preserves the previous artifact. The downloader defaults to all three supported assets.

All 75 automated tests pass, including simulated failed downloads/replacements, corrupted metadata, nonfinite prices and invalid provider envelopes. All 99 cached archives revalidated with zero failures and 1,004 daily observations per asset. Forecasts were regenerated successfully using the shared validation. No live API request is needed to reproduce those local checks.

## Forecast robustness across historical windows

The new expanding-window check evaluates three non-overlapping test periods per asset: 2025-04-26 to 2025-08-23 (120 returns), 2025-10-03 to 2026-03-11 (160), and 2026-03-14 to 2026-09-30 (201). Each prefix selects and calibrates using only its own earlier periods. There are gaps between the test windows. These are development backtests on available history, not new forward validation, and assets/windows are not claimed independent.

| Asset | Test coverage, earliest to latest | Windows reaching 90% target | Windows beating rolling reference score |
|---|---|---:|---:|
| BTC | 99.17%, 84.38%, 91.04% | 2 / 3 | 0 / 3 |
| ETH | 97.50%, 91.88%, 95.02% | 3 / 3 | 0 / 3 |
| PAXG | 99.17%, 90.62%, 89.05% | 2 / 3 | 1 / 3 |

Calibration is not consistently beneficial. High coverage can come from overly broad intervals, and coverage can fall below target in a different period. No parameters or selected production artifacts were changed in response to these results. `/risk` now explicitly reports when the saved selected model did not beat its simple reference. Treat the prediction component as an uncertainty-explanation experiment; it has not established trading advantage or reliable nominal coverage.

```powershell
python model/evaluate_regimes.py
```

Full hashes, cutoffs and scoring metrics are in ignored `model/results/forecast_regimes.json`. The check does not overwrite forecasts used by the assistant.

## Natural calculation latency

Complete, focused requests for explicitly mock fees, labeled no-interest savings and exact-date USDT historical what-if calculations now use the same deterministic tools directly in Thai and English. Mixed advice, risk/app questions, unsupported currencies, incomplete dates and ambiguous multi-asset requests remain with Qwen. This routing does not execute trades or assert an actual fee schedule.

The same six numeric scenarios that previously used Qwen now pass exact-tool-field checks with zero model calls. In the measured local run, median elapsed time was 0.0025 seconds and maximum was 0.006 seconds, compared with the earlier model-loop median of 15.9245 seconds. This measures different routes for these explicit cases, not model acceleration or general natural-language performance. All 79 automated tests pass.
