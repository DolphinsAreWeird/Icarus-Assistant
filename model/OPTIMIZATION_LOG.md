# Optimization checkpoints

Human wording/financial review is deferred. These checkpoints record engineering checks, not expert approval. Backend, frontend and transaction execution are outside this work.

## User-input grounding

Model-selected monetary arguments must match explicit currency-bound user inputs, or an explicitly referenced saved budget. New bare amounts cannot silently inherit an older currency. Prefix currencies, grouped numbers and unspaced Thai input are recognized; negative amounts are rejected rather than reinterpreted as positive. Savings target/current values require matching role labels. Historical what-if dates and assets must match the current request or explicit recent context.

All 68 automated tests passed at this checkpoint. Six live numeric scenarios passed tool-name and exact-tool-field checks in English and Thai: prefixed/unspaced budgets, savings roles and ETH historical what-if dates. Model-turn median was 15.9245 seconds; maximum was 30.189 seconds. This is one run and demonstrates correctness of those cases, not acceptable universal voice latency.

```powershell
python model/evaluate_assistant.py --live --suite numeric --limit 6
```

Natural-language goal calculations now need explicitly labeled target/current amounts and an ISO deadline; `/goal` remains the direct typed interface. Missing or ambiguous inputs produce a tool error for clarification. Broader natural-language parsing remains deliberately conservative.
