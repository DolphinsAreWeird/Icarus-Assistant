# Prototype status, 15 October 2026

Latest checkpoint, 16 October 2026: work continues on the renamed `assistant-model` branch. Added causal daily-return intervals with separate selection/calibration/test periods, input-provenance hashes and empirical coverage reporting, alongside the existing variance baselines. Added four primary-source-backed bilingual knowledge records and a 28-query retrieval development set. See `MODEL_CARD.md` for real-data results and reproduction commands. The simple rolling reference remains competitive; no trading advantage or guaranteed interval coverage is claimed. Earlier chronological notes below describe prior checkpoints.

Checkpoint verification: 54 automated tests pass, including future-data leakage, frozen selection/calibration and invalid market metadata. Four new live English/Thai slippage/stablecoin scenarios pass structural checks; observed times range from about seven to nineteen seconds. Both `/risk` renderers expose the saved interval and empirical coverage without a model call. Luka/First review remains pending in parallel.

Assistant-quality continuation: committed the prediction/retrieval checkpoint as `4a702b4`, then added a 16-query everyday-language retrieval challenge and a 12-scenario bilingual stress suite with multi-turn context, source requirements and separate local/model latency. Narrow concept expansion and non-crypto fee/gas disambiguation fix the observed retrieval misses. Live testing exposed unsupported tax prose and Thai truncation; focused missing-tax-evidence and essential-funds templates now address those cases without a provider call. See `evaluation/STRESS_EVALUATION.md` for findings and scope. Human review stays pending in parallel.

Continuation verification: 61 automated tests pass. Both retrieval development suites pass. Focused conceptual explanations use JSON mode without calculation tools; amount, current-data and comparison requests retain the normal tool loop. No backend or frontend changes were made.

## Implemented

- English/Thai source-backed retrieval and Qwen tool orchestration.
- Five synthetic profiles and a versioned draft guidance policy.
- Fee, savings-goal, portfolio-concentration, historical-summary, common-period-comparison, what-if, and experimental risk tools.
- Deterministic bilingual numerical summaries and allowlisted limitation messages.
- Explicit English/Thai profile intake, corrections, and per-field user-stated provenance; conservative handling of hypothetical/quoted/compound wording.
- In-process interactive memory with retained source records, language switching, readable CLI output, and opt-in named local persistence.
- Deterministic factual commands for portfolio, comparison, history, risk, what-if, and savings goals; no model request is needed for those commands.
- Strict tool allowlist, forecast-path asset validation, currency mismatch checks, invalid-input correction, and model-output validation/fallbacks.
- A standalone market preparation script, exploratory risk experiment, CLI, and Python integration interface. No application backend was added.

## Real data obtained

99 Binance monthly archives downloaded and checksum verified. BTCUSDT, ETHUSDT, and PAXGUSDT each have 1,004 daily candles from 2024-01-01 through 2026-09-30, with no missing days detected. The manifest records archive URLs and hashes. Spot timestamp-unit differences are normalized deliberately.

The historical data is in USDT, not USD or THB, and is not a current execution quote. App fees, profile amounts, and portfolio valuations are synthetic. No real transaction can execute.

## Prediction experiment

Fixed rolling and EWMA next-day variance baselines were evaluated chronologically against squared daily log returns, with 201 held-out observations per asset. Saved reports give errors and estimates at the historical cutoff. This is a starting research experiment, not a validated production predictor, directional forecast, or demonstrated trading advantage.

## Verification and remaining review

Automated calculation/input/source/currency/guard tests pass. Live synthetic cases exercised both languages, clarification, tool results, historical calculations, and constraints around essential funds. Live evaluation files retain a human-review-pending flag; structural passes are not a suitability or language-quality score.

Testing found and fixed numerical-meaning vulnerabilities, forecast path traversal, retrieval aliases, invalid fee commands, ambiguous fee shortcuts, and gateway message sequencing. A mixed-script Thai answer was observed; Chinese-script mixing is now rejected and recognized fee-only questions use deterministic wording. Thai spelling/naturalness and prose claims still need human review.

Qwen latency remains substantial and variable. Some live cases required tens of seconds. Gateway failures return an explicit fallback with available tool data. The known candidate no-thinking flag has not worked. Fee-only templates avoid model calls; this does not establish overall voice latency.

Remaining: financial and Thai review; actual app registry/fees/screen data integration; reviewed personalized allocation policy if exact recommendations are wanted; live price/FX policy; broader natural-language profile extraction beyond explicit supported forms; production multi-user storage/authentication; and voice/app execution integration owned by other systems.

Continuation verification: thirty automated tests pass. English and Thai multi-turn live scenarios completed, including changed constraints. A Thai comparison took forty-seven seconds in one run, so complex voice responsiveness remains unresolved. Accepted reasoning-effort fields still produced reasoning tokens and are not enabled as a performance fix.

Human demo reviewers are Luka and First, assigned by the user. Their checklist is `evaluation/HUMAN_REVIEW.md`; actual review remains pending.

Start with `START_HERE.md`. No API key or personal account data is included in reports.

Adapter milestone: validated frozen app snapshots, exact displayed-chart explanations, caller-bound account values with observation labels, and public USDT reference-price ingestion are implemented. Forty-two automated tests pass. Live English/Thai chart cases used the exact supplied fixture tool. A wrong canned historical-USDT limitation on the Thai THB fixture was detected; displayed limitations now follow the actual tool metadata. Dynamic remembered chart/account/price evidence is invalidated across turns. The root `.gitignore` and commit instructions are prepared; Git was not initialized or committed automatically.

Git integration update, 16 October 2026: local work is on `luka/assistant-model`, based on the team repository's `origin/main`. The team README and ignore rules are preserved. Source, experiments, tests, and documentation are split into focused local commits. Private credentials, local sessions, generated reports, and downloaded/generated data remain ignored. No push or merge into main is part of this checkpoint.
