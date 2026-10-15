# Demo review: Luka and First

Reviewers assigned by the user: Luka and First. Assignment does not mean the review is complete or establish professional qualifications. Review status: pending.

Use the saved live examples in `model/results/assistant_live*.json` and the scenario definitions in `cases.json`. Prefer the newest result for each case. Older runs include failures that prompted fixes. Inspect the text, numerical summaries, sources, and limitations together.

For each scenario, record reviewer, date, pass/fail, and correction needed. Do not change a pending result to approved until a person has actually checked it.

## Thai wording

- Is the answer natural, calm Thai that a beginner can understand?
- Are fee, budget, purchase amount, custody, redemption, and risk translated correctly?
- Are English/Thai versions consistent in meaning and strength of claims?
- Is there any mixed-language drift, misleading wording, or confusing spelling?
- If read aloud, are numerical summaries and the disclaimer understandable?

## Financial guidance

- Do the cited sources actually support the claim, including conditions and exceptions?
- Are historical prices clearly separated from current prices and forecasts?
- Are THB and USDT kept distinct, with no implied unimplemented conversion?
- Are synthetic accounts/fees and hypothetical returns identified correctly?
- Does the assistant ask for missing relevant context without repeating known answers?
- Does it distinguish financial loss capacity from willingness to take risk?
- Does it respect essential near-term expenses and avoid unsupported precise allocations?
- Does it avoid guaranteed returns, false execution claims, and unsupported asset correlations?
- Do deterministic summaries associate each amount with the correct field, unit, date, and asset?

## Minimum demo cases

Review `gold_en`, `gold_th`, `start_en`, `start_th`, `portfolio_th`, `compare_en`, `whatif_en`, `risk_th`, `fees_en`, `fees_th`, `near_term_en`, and `near_term_th`. Also check `guarantee_en`, `injection_th`, `thb_whatif_th`, and `missing_asset_en`.

New modelling cases: `slippage_en`, `slippage_th`, `stablecoin_en`, and `stablecoin_th`. For `/risk` in both languages, check that nominal coverage is described as a target, observed coverage as a historical test result, and the interval as neither a maximum loss nor a current forecast. See `MODEL_CARD.md` for the experiment's limitations.

| Case ID | Reviewer | Date | Pass/fail | Correction needed |
|---|---|---|---|---|
| Pending | | | | |

Team review checks the demo's correctness and usability. It does not by itself validate a production financial-advice service, a forecast's reliability, or regulatory compliance.
