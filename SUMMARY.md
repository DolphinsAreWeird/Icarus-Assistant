# Icarus modelling summary

Updated: 16 October 2026. Branch: `assistant-model`.

## Current status

The model/data-processing prototype runs locally and connects to the configured Orion model. It combines an English/Thai assistant, source-backed knowledge retrieval, user context, deterministic financial tools and a separate statistical prediction experiment.

The latest engineering checkpoint passed 83 automated tests, both retrieval development suites, six local numeric scenarios and the offline conversation suite. A final six-case bilingual live smoke run passed structural checks. These checks establish implementation behavior for the tested cases; they do not establish professional financial approval, universal answer accuracy or prediction reliability.

The financial review is prepared but **not completed**. No reviewer approval has been recorded.

## What was built

### Assistant and user context

- Connected the OpenAI-compatible Orion gateway at `https://api.orion.cmkl.ai/v1`, using the verified model ID `Qwen 3.8-27B-NVFP4`.
- Added Thai and English responses, a CLI and a Python interface. Qwen is used through inference; it has not been fine-tuned.
- Prepared 12 bilingual knowledge records with source URLs, checking dates and draft review status. Topics include BTC/ETH, fees, PAXG, goal/risk fit, diversification, history/forecast limitations, price impact, slippage, platform custody risk and stablecoin mechanics, plus explicitly mock app rules.
- Added explicit profile intake, corrections, per-field provenance, conversation memory, language switching and optional local session persistence. Five fictional profiles are available for demonstrations.
- Kept hypothetical or ambiguous statements from silently becoming user facts. Loss capacity and willingness to take risk are separate fields.
- Changed normal calculation dates to the current local day. Fixed dates remain available for reproducible demonstrations and evaluations; new runtime sessions advance across midnight/resume.

### Financial tools and numerical grounding

- Implemented mock platform fees, no-interest savings contributions, visible portfolio concentration, historical summaries, common-period comparisons, historical what-if calculations and experimental risk outputs.
- Rendered financial figures directly from named tool fields in bilingual numerical summaries. Model-generated prose containing digits is rejected; spelled-out quantities and qualitative claims still need semantic review.
- Bound monetary arguments to explicitly stated amounts/currencies or an explicitly referenced saved budget. New bare amounts cannot silently inherit an older currency.
- Checked savings target/current roles, historical dates and what-if asset identity. Unsupported arguments produce an error for clarification rather than a fabricated calculation.
- Added deterministic routes for complete, focused natural-language calculations and essential near-term money guidance. Mixed advice and ambiguous requests retain model planning.
- Added missing-evidence handling for focused Thai tax-form questions and stronger instructions for unsupported facts.
- Derived historical/synthetic/saved-reference/experimental labels from successful tool provenance rather than model-selected labels.
- Kept tool calls allowlisted and execution-free. The prototype cannot buy, sell or confirm a transaction.

### Data processing and prediction

- Obtained and checksum-verified 99 Binance monthly archives for BTCUSDT, ETHUSDT and PAXGUSDT.
- Prepared 1,004 daily observations per asset from **2024-01-01 through 2026-09-30**, with no missing days in the saved series. Normalized archive timestamp-unit differences.
- Validated asset identity, USDT currency, daily continuity, coverage endpoints and finite candle values whenever historical data is consumed.
- Added atomic artifact publication. An incomplete refresh preserves the affected asset's previous valid series and reports failure.
- Evaluated rolling/EWMA variance baselines and empirical return intervals. Interval candidates have separate chronological selection, calibration and test periods, with causal rolling updates and input hashes.
- Checked robustness across three non-overlapping historical test windows per asset. The evaluation does not silently retune production artifacts after seeing test results.
- Labeled forecasts as historical-cutoff experiments. PAXG is an exchange-traded gold token proxy; it is not a physical-gold spot index. USDT observations are not USD or THB returns.

### Interaction with the team's systems

- Added a validated, frozen snapshot adapter for caller-bound account values, reference prices and exact displayed-chart points/versions.
- Rejected changed chart versions, missing account data and unsupported currency pairs. An absent app account cannot fall back to fictional seed holdings.
- Invalidated remembered dynamic prices, charts and account values between turns.
- Added an optional public Binance USDT reference-price loader. Saved observations are labeled snapshots; they are not executable quotes.
- Documented the Python integration contract. Application authentication, frontend/voice behavior and transaction execution remain owned by the relevant team systems.

### Reliability, evaluation and review preparation

- Added explicit fallbacks for malformed provider responses, invalid model output and unreadable local data.
- Added a 28-query retrieval regression set, a 16-query everyday-language challenge, a 12-scenario bilingual stress suite and six numeric scenarios.
- Fixed observed retrieval misses, irrelevant fee/gas matches, unsupported tax prose, unnecessary tool calls, Thai output failures and incorrect origin labels.
- Added a network-blocked offline verification command.
- Prepared a financial review packet containing **12 topics and 24 English/Thai answers**, with expected behavior, numerical summaries, sources, sample provenance and a decision sheet for Luka and First. All verdicts remain pending.

## Performance and prediction findings

| Finding | What it means |
|---|---|
| Six explicit numeric scenarios ran with zero model calls; measured median 0.0025 s and maximum 0.006 s | Clear calculations can be effectively immediate locally. This does not measure general conversational latency. |
| Earlier model-loop execution of those scenarios had median 15.9245 s and maximum 30.189 s | Avoiding unnecessary model round trips materially helps these specific requests. |
| Final live smoke run: four model turns, median 11.4905 s, maximum 17.61 s | Open-ended explanations still have noticeable and variable delay. |
| Latest saved interval test coverage: BTC 91.04%, ETH 95.02%, PAXG 89.05%, against a 90% target | Nominal coverage is a target, not a guaranteed probability or maximum loss. |
| Selected calibrated intervals beat the rolling reference in only one of nine historical asset/window checks | The prediction experiment has not demonstrated consistent improvement or trading advantage. |

The retrieval sets were used during development. Their passing results are regression evidence, not an independent measure of broad language understanding. The historical test windows have already informed development; a genuinely new forward period is still needed.

## What is left or missing

| Item | Owner / dependency | Priority and current workaround |
|---|---|---|
| Financial meaning and Thai review | Luka and First; specialist questions may require further evidence | Review the examples intended for the demo. The packet is ready; approval is pending. |
| Actual fees, minimum amounts and supported asset identities | Product/app owner supplies authoritative rules | Mock rules can remain clearly labeled for a demonstration. They must not be presented as real product rules. |
| Actual screen/account/price payloads | Team app/backend/frontend owners supply data; model work connects the existing adapter | Snapshot fixtures work now. Real integration requires agreement on identity, versions, units and data freshness. |
| Current price/FX policy | Product/data owners choose sources and acceptable staleness | Public USDT references are optional. There is no implemented automatic THB/USDT conversion or executable quote service. |
| Faster open-ended model responses | Model measurement plus supported options from the Orion operator | Deterministic calculations are already fast. No reliable supported no-thinking setting has been established. |
| Better prediction evidence | Model/data work on new observations and predeclared evaluation criteria | Keep saved outputs experimental and historical. Further model complexity is not justified by the current scores alone. |
| Broader independent assistant evaluation | Model developer; reviewers can contribute natural questions | Expand paraphrases, unsupported topics and multi-turn situations beyond the examples used to develop fixes. |
| Broader profile language coverage | Model developer, supported by language review | Explicit supported clauses and `/set` work. Unknown wording is intentionally not silently persisted as a fact. |

For use with real users, the team systems must also provide authenticated account/profile binding, appropriate storage/privacy behavior and handling of late responses after navigation. The model interface does not implement these application responsibilities.

## Questions still requiring an answer

| Question | Who should answer | What remains usable meanwhile |
|---|---|---|
| Which exact advice scenarios will the first demo present? | Product/team | The prepared review topics cover the current broad prototype scope. |
| Is explaining trade-offs sufficient, or are exact personalized allocations expected? If allocations are expected, what reviewed policy supports them? | Product owner and appropriate financial reviewer | The current assistant asks for missing context and explains risks; it does not invent exact allocations. |
| Should the prediction feature expose uncertainty/volatility, or is directional price/return prediction actually required? | Product/model owner | The implemented experiment estimates daily risk/return intervals, not a profitable buy/sell strategy. |
| What improvement and coverage criteria would justify accepting a new prediction model? | Model/product owner | Retain the simple reference and report current failures honestly. |
| What are the real fee schedule, purchase minimum, supported tokens and gold product/redemption rules? | App/product owner | Use explicitly synthetic rules and source-backed PAXG education without claiming they describe the actual product. |
| Which data source, currency, refresh interval and freshness limit should real prices and FX use? | App/data owner | Use the supplied snapshot's explicit units and observation time; do not infer conversions. |
| What do real screen/chart/account payloads look like, and who binds them to the user/session? | Team integration owners | Use the documented fixture contract. |
| What response delay is acceptable for the intended text/voice demo? | Product/team; Orion operator for supported provider options | Fast calculations and variable-latency open-ended explanations can be demonstrated separately. |
| Which review corrections do Luka and First require, and which examples can they approve? | Luka and First | Leave every review status pending until an actual decision is recorded. |

These questions do not all block the labeled local prototype. They become necessary when making the corresponding product claim or replacing the relevant fixture with real behavior.

## Suggested next sequence

1. Luka and First review the prepared examples and record exact corrections or missing evidence.
2. Apply corrections and regenerate affected examples before marking them reviewed.
3. Confirm the demo's advice/prediction scope and keep unsupported claims out of the presentation.
4. Connect real app rules/payloads when supplied, using the existing model adapter.
5. Continue independent language testing and forward prediction validation. Investigate provider latency if it is unacceptable for the chosen interaction.

## Run and reproduce

From the `assistant-model` checkout:

```powershell
# Offline engineering verification; gateway calls are blocked.
python model/verify_checkpoint.py

# Interactive assistant; local model/.env is loaded automatically.
python model/assistant.py --interactive --lang th
python model/assistant.py --interactive --lang en

# On a fresh checkout, prepare ignored data artifacts before market verification.
python model/prepare_market_data.py --assets btc eth gold --start 2024-01 --end 2026-09
python model/predict_risk.py --asset all
python model/evaluate_regimes.py

# Rebuild the review packet from local calculations and recorded answers.
python model/prepare_financial_review.py
# Add --refresh-live only when refreshing the eight open-ended Orion samples.
```

Archive preparation needs network access; cached verified archives are reused. Interactive/model refresh routes can consume Orion quota. Downloaded data, generated experiment reports, local sessions and credentials are ignored by Git. They are not transferred merely by cloning this branch. The curated financial-review packet is committed deliberately so reviewers can access it.

## Documents to start with

- [Model usage and setup](model/START_HERE.md)
- [Financial review decision sheet](model/evaluation/FINANCIAL_REVIEW.md)
- [Prepared bilingual review answers](model/evaluation/review/FINANCIAL_REVIEW_PACKET.md)
- [App integration contract](model/INTEGRATION.md)
- [Prediction model card](model/MODEL_CARD.md)
- [Optimization checkpoints and limitations](model/OPTIMIZATION_LOG.md)
- [Remaining items by owner](model/evaluation/REMAINING_ITEMS.md)

## Branch/worktree separation

At preparation time, `D:\Uhackathon` is the `assistant-model` checkout. The separate `D:\Uhackathon\.worktrees\backend` checkout is on `backend`. This summary belongs to the model branch; backend work is left untouched. Modelling/review work through commit `33b967a` was pushed to `origin/assistant-model` before this summary was added. No merge into `main` was performed.
