# Financial and Thai review — Luka and First

Status: **pending**. Start with [the prepared answer packet](review/FINANCIAL_REVIEW_PACKET.md). It contains 12 topics, each with an English and Thai answer, numerical summaries, source links and the expected behavior. Read both languages for each topic before deciding.

## How to review

1. Check whether the source supports the actual claim, including restrictions and uncertainty. A real URL alone is not enough.
2. Check the numbers against the displayed tool fields, including asset, currency, dates, cash inclusion and mock/historical labels.
3. Check the guidance against the stated goal and constraints. Missing circumstances should produce clarification, not an invented allocation. Loss capacity and risk preference must remain distinct.
4. Check that Thai preserves the English meaning and sounds natural. Read numerical summaries and the small disclaimer aloud if the demo uses voice.
5. Record a verdict and an exact correction. Leave uncertainty as **Needs evidence** rather than guessing.

Use **Pass**, **Needs correction**, or **Needs evidence**. A topic passes only when both language versions pass. A correction should identify the sample ID, offending sentence, why it is misleading and proposed replacement. After a code/wording change, regenerate the affected example before signing it off.

## Decision sheet

Reviewed packet generated-at timestamp: __________. Reviewed source revision: __________. Decisions apply to that packet; regenerating it does not approve new answers.

| Topic / sample IDs | Reviewer | Date | Financial meaning | Thai meaning | Verdict | Correction / evidence needed |
|---|---|---|---|---|---|---|
| Mock fees — fees_en / fees_th | | | | | Pending | |
| Savings — savings_en / savings_th | | | | | Pending | |
| Essential money — essential_en / essential_th | | | | | Pending | |
| Corrections — correction_en / correction_th | | | | | Pending | |
| Concentration — portfolio_en / portfolio_th | | | | | Pending | |
| Historical comparison — comparison_en / comparison_th | | | | | Pending | |
| Historical what-if — whatif_en / whatif_th | | | | | Pending | |
| Forecast uncertainty — forecast_en / forecast_th | | | | | Pending | |
| Gold redemption — gold_en / gold_th | | | | | Pending | |
| First guidance — start_en / start_th | | | | | Pending | |
| Slippage — slippage_en / slippage_th | | | | | Pending | |
| Stablecoin yield — stablecoin_en / stablecoin_th | | | | | Pending | |

## Items that need an explicit decision

- **Mock rules:** approve their demo labeling, not their accuracy as real app fees.
- **Essential-money rule:** the one-year conflict flag is a conservative demo policy, not a validated suitability threshold.
- **Personalized guidance:** approve the specific demonstrated behavior; the prototype does not establish an exact personalized allocation policy.
- **Forecast claims:** approve clear experimental wording, not forecasting reliability. Several historical windows miss nominal coverage and the model generally fails to improve on its simple reference.
- **Scope:** tax/legal requirements, current execution quotes and provider-specific protections have no verified coverage unless actual authoritative inputs are supplied.

Reviewers may split the work or both inspect disputed cases. This is team correctness/usability review; it does not certify professional qualifications, future prediction performance or production regulatory compliance.

## Refreshing examples

```powershell
python model/prepare_financial_review.py
# Refresh eight open-ended examples against Orion; consumes quota:
python model/prepare_financial_review.py --refresh-live
```

The default command reuses completed recorded answers for open-ended examples and labels their origin. Deterministic examples execute locally. Refreshing creates new samples; it does not approve them or edit this decision sheet. The JSON companion retains complete tool data for numerical checking. Avoid replacing a signed-off packet without recording which revision was reviewed.
