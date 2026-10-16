# Remaining items after the runnable model prototype

The prototype runs now. The items below have different purposes and owners; they are not one combined blocker.

| Item | What it means | Who supplies it | Needed for a labeled mock demo? |
|---|---|---|---|
| Financial and Thai review | Check source meaning, guidance appropriateness, figures and natural Thai in the prepared packet | Luka and First; unresolved specialist questions stay marked Needs evidence | Review the examples you will actually show |
| Actual app rules and payloads | Confirm real fees, supported assets/token identities, screen versions and account/chart data, then feed the existing model adapter | App/team owner confirms facts; model integration consumes them | Fixtures can be used if clearly labeled synthetic |
| Open-ended Qwen latency | Investigate whether the gateway supports faster generation settings or a suitable faster model | Model developer can measure; Orion operator confirms supported options | Optional unless the demo's voice interaction needs faster replies |
| New forward prediction validation | Test the frozen method on later, previously unused observations and report coverage/score against the reference | Model/data work as new observations are obtained | Experimental historical forecasts can be shown with their cutoff and limitations |
| Broader assistant evaluation | Test independently written paraphrases, unsupported requests and realistic follow-ups beyond the examples used to develop the fixes | Model developer; reviewers can contribute natural questions | Continue iteratively; keep demonstrated scope clear |

## What is already handled

Validated Python tools and snapshot interfaces, English/Thai knowledge retrieval, explicit profile context and corrections, currency/date/amount grounding, deterministic simple calculations, archive ingestion, historical risk experiments and offline engineering verification are implemented. Team app integration uses the contract in `model/INTEGRATION.md`.

Simple complete calculation requests avoid the cloud model. Open-ended explanations still use Orion and can take seconds to tens of seconds; the available measurements do not identify a supported switch that reliably eliminates this delay.

The saved prediction input ends on 2026-09-30. Backtests across several windows show inconsistent coverage and generally no improvement over the simple reference. A fresh test period is needed before making a stronger reliability claim. Human approval of wording does not fix prediction performance.

## Immediate review workflow

Open `FINANCIAL_REVIEW.md`, read the linked bilingual packet, and record corrections. There is no need to build a new backend to perform this review. Actual app rules become relevant when replacing fixtures with real product behavior. Provider tuning and forward validation can remain separate development tracks.
