# Icarus model prototype

Latest engineering checkpoint: run `python model/verify_checkpoint.py` from the repository root. It checks tests, retrieval, local calculations and prepared data with gateway access blocked. It requires the market artifacts below to have been prepared; it does not download them or imply human approval.

This is the model/data-processing part of Icarus. It includes a local Python interface and CLI, not an app backend. Python's standard library is sufficient; no additional packages are required.

The latest [modelling checkpoint](MODEL_CARD.md) documents daily-return intervals with separate model selection, calibration and testing, real-data results, bilingual retrieval coverage, and remaining modelling work. Regenerate all forecast artifacts with `python model/predict_risk.py --asset all`; `/risk` renders their historical cutoff, interval and measured test coverage in either language.

The [harder bilingual evaluation](evaluation/STRESS_EVALUATION.md) adds everyday paraphrases, unsupported questions, injection attempts and multi-turn corrections. Run `python model/evaluate_retrieval.py --suite challenge` locally, or `python model/evaluate_assistant.py --live --suite stress --limit 12` against Orion. Structural passes and semantic review are recorded separately.

See the [optimization checkpoints](OPTIMIZATION_LOG.md) for subsequent fixes. Model-selected financial tool inputs are checked against explicit user amounts/currencies/dates. Use labeled savings target/current amounts and an ISO deadline, or `/goal`. Run `python model/evaluate_assistant.py --live --suite numeric --limit 6` for the bilingual numeric scenarios.

The new [integration contract](INTEGRATION.md) explains validated app snapshots, current/reference-price adapters, exact screen/chart versions, and caller-bound account data. Start with `fixtures/app_snapshot.json` without a backend, or run `fetch_public_snapshot.py` for an explicitly labeled real USDT reference snapshot.

## What exists

- Source-backed English/Thai knowledge records, with citations and draft review status.
- Five fictional profiles; profile facts and portfolio values are explicitly synthetic.
- A draft guidance policy that distinguishes goals, time horizon, essential money, loss capacity, and willingness to take risk.
- Strictly allowlisted calculation tools: fee, goal math, visible portfolio concentration, common-period comparison, historical what-if, and exploratory risk forecasts.
- Real Binance public-archive history for BTCUSDT, ETHUSDT, and PAXGUSDT. Each archive was checksum verified and timestamp units normalized. Consult `data/market_manifest.json` for coverage and source files.
- A cloud Qwen tool loop, retrieval preview for offline use, and instant bilingual fee templates.
- Financial figures rendered directly from named tool fields into `numerical_summaries`. Model text may explain qualitatively but digits are rejected; limitation messages come from an approved code list.
- A curated evaluation suite and arithmetic/source/input validation tests.

The knowledge, financial-guidance rules, and Thai translations are drafts pending human review. Spelled-out quantities, qualitative claims, recommendation appropriateness, and source interpretation still require evaluation. This prototype is not a validated financial adviser.

## Try without any model request

From `D:\Uhackathon`:

```powershell
python model/assistant.py '/fee 1000' --lang en
python model/assistant.py '/fee 1000' --lang th
python model/assistant.py 'What does PAX Gold ownership mean?' --lang en --offline
python model/assistant.py 'ค่าธรรมเนียมเครือข่ายคืออะไร' --lang th --offline
```

`--offline` is an explicit knowledge preview, not a simulated model response. `/fee` uses a mock fee policy and does not execute a purchase. Malformed or below-minimum budgets return input correction rather than buying anything.

## Use your Orion Qwen

The existing `model/.env` is loaded automatically. Do not share it. The verified gateway model ID is `Qwen 3.8-27B-NVFP4`.

```powershell
python model/assistant.py 'I have 5000 baht and want to invest in crypto. Where should I start?' --lang en --profile new
python model/assistant.py 'ควรเอาเงินค่าเทอมไปลงทุน Bitcoin ไหม' --lang th --profile near_term
python model/assistant.py 'Compare Bitcoin and PAX Gold over the available common historical period.' --lang en --profile long_term
python model/assistant.py --interactive --lang th --profile concentrated
```

The interactive runner now remembers explicit user-stated goals and constraints, with the exact source clause and turn. Corrections override earlier values. Automatic extraction is conservative: hypothetical, quoted, ambiguous, or compound statements are not silently saved as facts. Unsupported wording can still be discussed with Qwen; use `/set field value` for an unambiguous profile update.

```text
My goal is long term savings
My horizon is 5 years
This money is not essential
My loss capacity is moderate
My risk preference is moderate
```

Thai equivalents:

```text
เป้าหมายคือออมระยะยาว
ระยะเวลาลงทุน 5 ปี
เงินนี้ไม่ใช่เงินจำเป็น
ความสามารถรับผลขาดทุนคือปานกลาง
ความเต็มใจรับความเสี่ยงคือปานกลาง
```

Recognized factual intake makes no model requests. `/profile` shows current values and provenance. `/lang th` or `/lang en` switches language without clearing state. `/reset` clears this conversation's updates and memory back to its selected fictional seed; it does not delete unrelated evaluation data. `/quit` exits. Interactive answers now use readable text; `--json` shows the integration payload instead.

Persistence is off by default. Add `--session demo` to save and resume a named local session in ignored `model/results/sessions/`. This stores user-entered context and recent conversation, so use fictional demo information unless you intend that local storage. A saved session's profile and language take precedence over startup defaults; use `/lang` to change its language. New sessions use the host's current local date and advance across midnight/resume. Pass `--today 2026-10-15` for a reproducible fixed demo; an explicit `--today` also overrides a loaded session's date. Legacy sessions retain their saved fixed date. App integrations can pass the user's local date explicitly. Responses expose `calculation_date`; session responses also expose `date_mode`.

```powershell
python model/assistant.py --interactive --lang en --session demo
```

Fast factual commands make no model requests and render actual tool fields:

```text
/portfolio
/compare btc gold
/history btc
/risk btc
/whatif btc 1000 USDT 2024-01-01 2026-09-30
/goal 50000 1000 THB 2027-06-15
/prices THB btc gold
/chart
```

`/portfolio` needs a profile with holdings, such as `--profile concentrated`. `/whatif` requires USDT explicitly; `/goal` requires THB explicitly. These commands return sourced calculations, not personalized allocation advice. Dates and currency restrictions are checked. `/risk` is a saved historical-cutoff experiment, not a current trading signal.

`/prices` and `/chart` need `--snapshot` or an app-provided adapter. Example: `python model/assistant.py /chart --lang th --snapshot model/fixtures/app_snapshot.json`. The included chart is fictional. Changed chart versions are rejected; remembered dynamic prices/accounts/charts cannot bypass a fresh tool read. No implicit currency conversion is performed.

Results contain `text`, `disclaimer`, `sources`, `tool_results`, `numerical_summaries`, `limitations`, and model-call timing. Display numerical summaries alongside the explanation. Feed deterministic summaries to TTS when exact amounts need speaking. The plain `text` field intentionally avoids financial figures.

Explicit commands and complete, focused English/Thai mock-fee, labeled savings and exact-date historical what-if calculations skip Qwen. Mixed advice and ambiguous inputs retain model planning. Other questions may make multiple sequential model calls; measured latency remains significant. No supported no-thinking mode has been established for Orion. Unexpected Chinese-script mixing and missing Thai in a Thai response are flagged; spelling and financial meaning still need Thai review. Do not promise low voice latency from this prototype.

Additional latency probes accepted `reasoning_effort=none/low`, but the gateway still reported reasoning tokens and one answer had degraded Thai wording. These fields are not enabled in the assistant. API acceptance does not prove that the requested reasoning mode was applied. Live multi-turn tests included a Thai comparison taking roughly forty-seven seconds.

## Python integration with the other components

When the `model` directory is on the Python import path:

```python
from assistant import answer

reply = answer(
    'What does this gold chart show?',
    language='en',
    profile_id='new',
    screen_context={
        'screen_id': 'asset_detail',
        'selected_asset': 'gold',
        'focused_element': 'asset.chart',
        'chart_period': '1m',
    },
)
```

For actual multi-turn state, use `ConversationSession` from `session.py` and call its `ask()` method. `answer()` also accepts validated `profile_updates` and `profile_provenance` for an app-owned session adapter. Neither interface authenticates users; a future backend must bind profile/account data to its authenticated session.

Screen context helps interpretation; this prototype has no verified mapping to live chart versions or real app data. The assistant should ask for unavailable chart data instead of inventing it. The returned `ui_actions` is empty: no UI navigation or transaction execution is available.

## Rebuild processing artifacts

```powershell
python model/prepare_market_data.py --assets btc eth gold --start 2024-01 --end 2026-09
python model/predict_risk.py --asset btc
python model/predict_risk.py --asset eth
python model/predict_risk.py --asset gold
```

Archive preparation needs network access but no API key. Cached verified archives are reused. Partial downloads are recorded honestly in the manifest; missing history is never fabricated. The forecast experiment rejects gaps.

Training/evaluation prices are exchange-specific USDT, not USD or THB. Do not attach those forecasts directly to THB prices without a separate conversion policy. The current history ends on a historical date; this is not a live price feed. What-if uses exact available daily closes with fees/spread/slippage excluded.

The risk experiment compares fixed rolling and EWMA variance baselines chronologically against squared daily log returns. It reports held-out errors and volatility at the last historical cutoff. It does not select a production model, establish statistical superiority, predict direction, or demonstrate profitable trading.

## Tests and evaluation

```powershell
python -m unittest discover -s model/tests -v
python model/evaluate_assistant.py --ids fee_fast_en fee_fast_th gas_th wallet_plural_en
python -u model/evaluate_assistant.py --live --limit 8
python model/run_conversations.py
python -u model/run_conversations.py --live --lang both
```

Only `--live` makes model requests. Results are saved under ignored `model/results/`, with human review explicitly pending. Structural checks are not a financial-quality score. Select additional cases by `--ids` to avoid rerunning unrelated tests.

The conversation suite checks both languages through clarification, explicit intake, common-period comparison, and correction to near-term essential money. Local intake/profile checks and live tool-use checks are reported separately from pending semantic review.

## Remaining integration inputs

Oasis/app owner: actual element registry, screen data versions, fee rules, and supported assets. Until then, do not claim U-topia integration.

Financial reviewer: guidance policy and personalized examples. Thai speaker: factual meaning and naturalness. Orion operator: supported low-reasoning/non-thinking options if available.

These are separate from a runnable model prototype; no real money or personal account data is connected.
