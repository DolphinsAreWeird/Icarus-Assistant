# Icarus assistant and prediction research

Research date: 15 October 2026. Scope: Luka's model behavior, knowledge processing, optional predictions, evaluation, and interfaces to other systems. This supersedes the earlier assumption that Luka's primary deliverable is a market-data backend. It does not change implemented code; none exists in this workspace.

The user's current product intent includes financial guidance and a short disclaimer. Earlier context prohibited personalized investment advice. Treat the exact new advice scope as a pending product choice, not as an established restriction or unlimited authorization.

## Findings and selected technical approach

Separate three components:
1. Assistant: understands the request and screen, gathers evidence, uses tools, and explains.
2. Guidance policy: determines which user information is required and how evidence supports options or recommendations.
3. Optional predictor: produces a defined statistical forecast with out-of-sample evaluation. It does not substitute for the guidance policy.

Recommendation: start with a hosted tool-capable language model, reviewed knowledge records, deterministic financial functions, and a versioned guidance policy. Do not begin with fine-tuning or training a language model from scratch. This is an engineering recommendation for the hackathon, not a finding that any particular model is adequate.

Choose the actual hosted model using a small paired evaluation of available candidates: intent/tool correctness, evidence support, numerical accuracy, Thai/English behavior, response latency, and cost per completed interaction. Use the same fixtures and prompts for every candidate. Existing access, budget, and deployment constraints require human input.

## 1. Missing advice specification

Define supported request families before choosing data or training targets:
- App help: explain a chart, fee, term, button, or next operational step.
- Financial explanation: explain an asset or mechanism and material risks.
- Comparison: user-selected alternatives, common comparison basis, no omitted relevant costs.
- Goal fit: assess compatibility with a stated goal and constraints.
- Portfolio guidance: concentration, liquidity, diversification, and possible allocation alternatives.
- Market timing: directional forecast or buy/sell timing. This requires a separate modeling and evaluation track.

Do not collapse these into one generic "give advice" prompt. Store a policy for each intent: required inputs, relevant sources, permitted outputs, conditions for clarification, and unsupported cases.

Human choice: which families are in the first demo? Technical work can proceed on app help, explanation, and comparison fixtures while personalized recommendation scope is unresolved.

## 2. User information and memory

Research basis: automated advisory tools commonly collect goals, horizon, financial circumstances, and risk tolerance. Investor.gov warns that what tools ask and how questions are framed affect the resulting guidance. These are design references, not Thai legal requirements. [1,2]

Recommended profile fields, collected progressively rather than in one long questionnaire:
- Goal and deadline.
- Available investment amount and whether it is needed for essentials/emergencies.
- Need to access the money and ability to absorb a loss.
- Existing exposure, including assets outside the app if the user chooses to disclose them.
- Experience and understanding of the relevant product.
- Risk preference, recorded separately from financial loss capacity.
- Currency and user-stated restrictions.

For each field preserve: value, explicit/inferred/unknown status, source turn, updated time, and permission to persist. Do not infer affordability or risk tolerance from wallet size, age, or language. Missing outside holdings means portfolio conclusions are limited to the visible account.

Keep session memory separate from persistent profile memory. Remember pending asset, amount, question, and preview; accept corrections; resolve contradictions before personalized guidance. A user saying "I can lose everything" does not override a conflicting near-term essential goal.

Human review: questionnaire wording and the goal-fit/allocation policy should be reviewed by a person with relevant financial expertise before presenting them as reliable personalized guidance. A Thai speaker checks semantic equivalence, including risk and fee wording.

## 3. Knowledge processing and source selection

Use four evidence classes and keep them separate:
1. Reviewed financial concepts: diversification, fees, volatility, liquidity, custody, concentration, and time horizon.
2. Issuer/protocol facts: asset backing/mechanics, token supply rules, redemption conditions, smart-contract and issuer risks.
3. App-specific truth: supported assets, screens, minimums, fees, transaction process, and approved guidance.
4. Time-sensitive evidence: price/history, liquidity estimates, protocol events, and dated announcements.

Source priority is claim-dependent. Issuer terms establish redemption conditions, but issuer marketing alone is not an independent risk assessment. Use official protocol/issuer documentation for mechanics; regulator education for general principles; the client app's reviewed material for its own fees and workflows. Avoid incorporating arbitrary social-media posts as authoritative evidence.

Concrete source-quality example: Paxos's PAXG marketing describes gold backing and redemption, while its terms specify conditions and a substantial minimum for physical-bar redemption. The assistant must not convert "gold backed" into "every small holder can redeem a physical bar." [3,4]

Processing stages:
fetch permitted documents -> extract text and tables -> remove navigation/duplicates -> split by topic/section -> attach metadata -> review claims -> index approved records.

Knowledge record fields:
`record_id, asset_id, topic, title, text, source_url, source_section, published_at, fetched_at, reviewed_at, reviewer, language, version, approval_status, supersedes, refresh_policy`.

Keep dates unknown when not provided. Preserve units, conditions, table headers, and source sections. Treat web content as evidence, not instructions. Review record changes rather than automatically approving newly fetched content.

MVP retrieval: filter by asset, screen, intent, topic, and language; use direct lookup for glossary/UI records and keyword search for the small corpus. Add semantic retrieval only when a held-out query set demonstrates a retrieval problem. A vector database is optional. Avoid sending every document on every turn; long-context research demonstrates sensitivity to where relevant information appears, though those results do not directly measure current candidate models. [5]

Refresh policy: runtime financial numbers come from tools; app rules change on owner approval; static knowledge is reviewed on ingestion; issuer/protocol changes are flagged for review. Record corpus version in every evaluated answer.

## 4. Assistant behavior and interfaces

Input bundle:
`request_id, session_id, message, language, recent_turns, profile_with_provenance, screen_context, permitted_actions`.

Screen context contains selected asset, focused element, chart period, displayed data version, and visible element IDs. It is supplied by the frontend; the model cannot reliably reconstruct it from a vague question.

Recommended flow:
classify intent -> check missing inputs -> retrieve relevant approved records -> select tools -> apply guidance policy -> draft concise answer -> validate claims/numbers -> return text, references, proposed UI actions, and missing-input questions.

Use a small fixed intent vocabulary and allow an unknown/clarification outcome. No separate intent model is necessary initially. The tool-capable assistant can produce the structured intent and arguments, evaluated against fixtures.

Tool integration requirements: typed schemas, explicit units, timestamps, stable result IDs, unavailable-data responses, and numerical display phrases. Keep calculations outside the LLM. The assistant must associate each numeric claim with the correct field, not merely repeat a number that appeared somewhere in context.

Output fields:
`intent, text, evidence_refs, numerical_claim_refs, assumptions, limitations, clarification, proposed_ui_actions, disclaimer`.

Do not expose internal reasoning traces. Provide a brief evidence-based explanation, relevant alternatives, and material limitations. Source citations support factual claims; they do not prove the recommendation is appropriate.

Action execution is another system's job. The assistant may prepare a request; a user tap confirms it through that system's authenticated route.

Human inputs needed: UI registry/real app facts from Oasis or the app owner; actual tool schemas and fixtures from the data/backend owner; model account access. They do not need to be finished for mock-tool development.

## 5. Prediction: choose a target before a model

Predictions are optional until a user-facing feature needs them. Do not train an abandonment model simply because event data exists; do not train a price model solely to call the product AI.

If a distinct forecasting deliverable is required, recommended first experiment: next-day risk/volatility forecasting for BTC, compared with a rolling historical-volatility baseline. EWMA and a simple GARCH model are candidates, not guaranteed improvements. GARCH tooling explicitly supports variance forecasts and simulation; that does not establish profitable trading signals. [6]

Risk forecasts can support explanations of possible variation; they do not directly determine an allocation or predict return direction. Show forecast horizon, units, training cutoff, model version, evaluated coverage, and limitations.

If the chosen goal is return/direction prediction instead:
- Specify asset, reference currency, sampling cadence, horizon, and the exact target.
- Start with unchanged-price/zero-return and simple empirical baselines.
- Use chronological rolling-origin evaluation with a gap/purge covering overlapping label horizons. Fit preprocessing only on each training fold.
- Keep tuning separate from a final untouched test period.
- Features must have been available at the forecast timestamp. Revised news, future returns, and later token-unlock announcements are not valid historical inputs.
- Measure error or probability quality and, if making trading claims, simulated results after fees, spread, slippage, and drawdown. Do not select solely on directional accuracy.

Scikit-learn documents why ordinary cross-validation is inappropriate for time-ordered forecasting. Recent financial forecasting research reports small/sparse improvements over random-walk benchmarks in an equity study; its results are a caution, not evidence about BTC or Icarus. [7,8]

A year of daily data is only roughly 365 observations. More overlapping windows do not create independent market regimes. A forecasting experiment may need a separate, longer training history than the demo chart API supplies. Retain raw data, retrieval time, coverage, license, and transformations. Do not promise a validated predictor until these exist.

Human choice: is a distinct predictor mandatory? If so, choose risk/volatility, return direction, or another explicit target. This affects data needs materially.

## 6. Uncertainty and small disclaimer

Suggested fixed display text: "AI guidance may be wrong. Check the facts before acting."

Keep that small and separate from the answer. Within the answer, disclose specific limitations only when relevant: missing profile information, old market data, conflicting sources, unsupported assets, or weak forecast evidence.

Do not generate a confidence percentage from the LLM's self-assessment. For a probabilistic predictor, assess reliability diagrams and proper scores on held-out predictions; Brier score alone is not a pure calibration measure. [9]

Personalized guidance still needs a documented operating model. Thai SEC materials define digital-asset advisory services as a regulated category; applicable obligations need confirmation from the client/business and an appropriate qualified reviewer. This is separate from the user's requested disclaimer and does not block building a synthetic research/demo assistant. [10]

## 7. Evaluation and dataset plan

Use public financial benchmarks as supporting tests, not as the product's training curriculum or proof of suitability. FinanceBench evaluates evidence-based corporate financial QA; FinQA evaluates numerical reasoning over financial reports. Neither measures crypto-app navigation, Thai usability, or personalized suitability. Their older reported model scores are not current-model performance estimates. [11,12]

Create Icarus-specific evaluation cases. Suggested initial inventory: 60 scenarios, separate from prompt examples:
- 10 app explanations/navigation requests.
- 10 asset/mechanism/risk questions.
- 10 factual comparisons.
- 10 goal/profile-dependent guidance cases, once scope is agreed.
- 10 multi-turn corrections, ambiguous assets, and mixed-language cases.
- 10 failures: stale/missing data, contradictory evidence, unsupported guarantees, prompt injection, and absent user context.

For each case record: input turns, profile, screen, fixture tool outputs, relevant knowledge IDs, expected intent/tool arguments, required facts, acceptable answer variants, unacceptable claims, and expected clarification/action behavior.

Use automated tests for tool arguments, calculations, schemas, numerical-field mapping, and source IDs. Use an expert-reviewed rubric for financial appropriateness and Thai-speaking review for language. An LLM judge can triage but is not the sole reviewer. RAG evaluation research separates retrieval quality, faithful use of context, and answer relevance; apply those checks separately to diagnose failures. [13]

Split by underlying scenario, not just translated wording, so a Thai translation of a prompt example does not leak into the held-out set. Preserve a final untouched subset. Log model/prompt/corpus/tool versions, response time, and cost.

Suggested release gates are project choices, not research-established standards: no unsupported numeric claims or unintended action execution in the critical demo suite; every unavailable-data case handled explicitly; all personalized demo scenarios reviewed. Report pass counts and residual failures rather than claiming general accuracy from a small set.

Measure friction separately through task completion, elapsed time, help needed, and a short user-comprehension question. A fast answer or completed purchase alone does not establish understanding or advice quality.

## 8. Concrete model-side deliverables

Directory proposal (no backend required):
```
model/
  knowledge/          reviewed records and source manifest
  policies/           intent definitions and guidance rules
  profiles/           synthetic user fixtures
  tools/              schemas and mock result fixtures
  assistant/          prompt, retrieval, orchestration, validators
  prediction/         optional data preparation and baseline experiment
  evaluation/         examples, held-out cases, rubric, results
```

Build sequence:
1. Agree demo intents; prepare tool schemas and synthetic profiles.
2. Curate a small source-backed corpus and a source manifest.
3. Build intent/clarification/tool behavior against fixtures.
4. Run a paired model evaluation and select using measured results/access.
5. Add guidance policy and claim validation; review personalized scenarios.
6. Integrate real tool outputs and screen context.
7. Add an independently evaluated forecast only if required.

Research can settle this architecture and evaluation approach. Human input remains necessary for scope, actual data/model access, financial-policy review, real app facts, and Thai quality. No backend deployment or voice implementation is required from Luka.

## Sources

[1] SEC Investor Bulletin, Robo-Advisers: https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45

[2] SEC Investor Alert, Automated Investment Tools: https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/investor-56

[3] Paxos PAX Gold product information: https://www.paxos.com/pax-gold

[4] Paxos PAX Gold terms: https://www.paxos.com/terms-and-conditions/pax-gold-terms-conditions

[5] Liu et al., Lost in the Middle (2023): https://arxiv.org/abs/2307.03172

[6] arch, Volatility Forecasting: https://arch.readthedocs.io/en/stable/univariate/univariate_volatility_forecasting.html

[7] scikit-learn, TimeSeriesSplit: https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html

[8] Noguer I Alonso and Franklin, Pretrained Time-Series Foundation Models for Financial Return Forecasting (2026, preprint): https://arxiv.org/abs/2606.27100

[9] scikit-learn, Probability calibration: https://scikit-learn.org/stable/modules/calibration.html

[10] Thai SEC, Digital Asset Business: https://www.sec.or.th/TH/Pages/LawandRegulations/DigitalAssetBusiness.aspx

[11] Islam et al., FinanceBench (2023): https://arxiv.org/abs/2311.11944

[12] Chen et al., FinQA (2021): https://aclanthology.org/2021.emnlp-main.300v1.pdf

[13] Es et al., RAGAS (2023): https://arxiv.org/abs/2309.15217
