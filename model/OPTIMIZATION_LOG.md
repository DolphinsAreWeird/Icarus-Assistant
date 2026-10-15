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
