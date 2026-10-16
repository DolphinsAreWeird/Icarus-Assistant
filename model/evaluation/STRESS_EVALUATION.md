# Bilingual assistant development checks

The stress suite targets everyday phrasing, multi-source explanations, unsupported current Thai tax questions, attempts to force a withdrawal guarantee, and corrected financial circumstances across several turns. It is separate from the original demo suite so failures remain visible rather than replacing easier examples.

```powershell
python model/evaluate_retrieval.py
python model/evaluate_retrieval.py --suite challenge
python model/evaluate_assistant.py --suite stress --ids context_en context_th
python model/evaluate_assistant.py --live --suite stress --limit 12
```

The offline assistant command checks retrieval and explicit context handling only. Live mode consumes Orion quota. Outputs, timestamps and full turn results are saved under ignored `model/results/assistant_stress_*`. Human review remains pending and never blocks running these development checks.

## What changed after the first challenge run

The 16-query retrieval challenge contains six supported queries and two non-crypto queries per language. Initially only one of six English queries retrieved its expected evidence; none of the six Thai queries did. All four unrelated fee/gas questions incorrectly retrieved crypto records.

Retrieval now expands a small set of explicit concepts: sending Ethereum assets, receiving less than a quote, an exchange closing, dollar-pegged lending, holding one coin, and tomorrow's market movement. A narrow context check excludes passport, vehicle-fuel and cooking-gas uses unless crypto is explicitly part of the question. It preserves comparisons such as car fuel versus Ethereum gas.

After those changes, expected-record recall at five is 100% in both languages and all four non-crypto questions return empty retrieval. The original 28-query set still passes. These challenge queries were used to develop the fixes, so the improved figures are regression results, not an independent measure of generalization. This lexical approach still needs separately authored paraphrases and broader scope testing.

## What the assistant runner measures

- Whether the result has the declared expected status and claimed no UI execution. A deliberate unsupported-evidence response has `data_unavailable`; it is not graded as an invented answer or a successful calculation.
- Whether required source IDs are present; `all_sources` requires every expected record for multi-source explanations.
- Whether conceptual explanations avoid unnecessary tool calls.
- Whether explicit corrections survive into the final user profile.
- Local-turn and model-turn latency separately, including all turns of a conversation. Rejected/failed answers with no completed model call are classified separately.

Every result retains `semantic_quality: unscored` and `human_review: pending`. Passing these checks does not prove factual entailment, appropriate advice, natural Thai or refusal quality. The per-case `review` field states the semantic behavior that still needs checking. There is no automatic LLM judge pretending to supply human approval.

The injected guarantee cases must avoid affirming guaranteed recovery. The tax cases must disclose absent current authoritative evidence rather than inventing a form. The context cases must preserve low loss capacity and high risk preference as distinct facts, use the corrected shorter horizon and respect essential tuition money. Source-ID checks alone cannot establish any of those semantic outcomes.

## Live failures found and resolved

The initial full stress run passed 10 of 12 structural scenarios. The English tax answer acknowledged missing evidence but then added an unsupported filing-rule claim, which structural checks alone missed. The Thai tax answer produced prohibited numeric prose and was rejected. The Thai corrected-context answer exhausted its output budget and was also rejected. The run's model-turn median was 11.0715 seconds, with a maximum of 30.865 seconds. The four profile-intake/correction turns were local.

Focused Thai tax-form requests now return an explicit missing-current-evidence response without invoking Qwen. The route checks retrieved topic coverage and avoids obvious compound requests; it is a narrow scope guard, not a general legal/tax classifier. Open-ended unsupported topics still require evaluation. The model instruction also forbids appending facts from memory after acknowledging missing evidence and asks for possible transaction causes without unsupported diagnoses.

Focused questions about investing money needed soon for an essential payment now use a bilingual policy template only when current profile context establishes the essential near-term conflict and the goal/risk record is available. It preserves the distinction between risk preference and loss capacity. Unknown context and obvious compound questions remain with the model. This uses the existing conservative demo horizon rule; it does not validate that rule or establish an allocation.

The four targeted tax/context scenarios pass with no model calls after these changes. Automated tests cover profile corrections, missing context/evidence and compound requests. The actual wording remains a draft for later human review.

A subsequent run found unnecessary tools for conceptual Thai questions and a non-JSON response for a quote explanation. Focused sending-cost, received-amount and exchange-closure explanations now use the gateway's JSON response mode with no calculation tools exposed. Requests for amounts, current data, history, comparisons or calculations keep tool planning enabled. This is a narrow routing change; the rest of the assistant still uses its normal tool loop.

Final verification: all 12 stress scenarios pass their declared structural checks in the complete rerun. The eight model turns had a median of 9.7375 seconds and a maximum of 18.76 seconds. The eight local turns, including tax-evidence responses and profile intake/correction, had a median of 0.0005 seconds and a maximum of 0.001 seconds. These are observations from one run, not latency guarantees or a controlled performance comparison. All 61 automated tests and both retrieval development suites pass. Semantic quality remains unscored and human review remains pending.
