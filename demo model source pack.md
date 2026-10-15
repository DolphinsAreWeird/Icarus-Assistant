# Broad-demo model source pack

15 October 2026. The user wants broad demo coverage and currently has no dataset or existing model. Scope is assistant and prediction preparation, not backend implementation. Research identified the following sources; files, credentials, runtime compatibility, model quality, and network accessibility have not been tested or downloaded.

## Recommended demo coverage

| Capability | Processing/model | Source/input | Demonstration |
|---|---|---|---|
| App help and terminology | Intent resolution + reviewed lookup | Mock UI registry and app knowledge | Explain a fee or chart and identify the next step. |
| Asset explanation | Retrieval-grounded assistant | BTC/ETH documentation; PAXG terms | Explain what ownership means and the risks/conditions. |
| Asset comparison | Deterministic common-field comparison + assistant | Prices/history, asset knowledge, mock fees | Compare BTC, ETH, and PAXG without inventing missing fields. |
| Goal fit and financial guidance | Explicit user profile + reviewed decision policy + assistant | Synthetic goals/constraints; education sources | Explain compatibility, trade-offs, missing information, and alternatives. |
| Portfolio guidance | Concentration, loss scenarios, and optional allocation alternatives | Synthetic portfolio and explicit policy | Explain visible-account concentration and consequences of different choices. |
| Historical what-if | Calculation, not prediction | Historical price series | Calculate a dated hypothetical purchase with fee assumptions. |
| Savings goal | Deterministic schedule calculation | User target/date/cash contribution | Calculate contributions without assuming investment returns. |
| Risk forecast | Rolling volatility baseline; EWMA/GARCH challenger | Clean daily historical returns | Show next-day variability estimate and validation results. |
| Direction/price forecast | Experimental statistical or pretrained challenger | Same chronological dataset | Show an evaluated forecast only if it passes a baseline comparison; otherwise report failure to find an advantage. |
| Unlock alerts | Event lookup and explanation | Tokenomist, if credentials supplied | Explain a verified dated unlock; never claim certain price impact. |

Broad coverage is achieved through reusable evidence, calculations, and policies. It does not require training a separate model for each feature. Allocation/timing coverage remains contingent on a reviewed policy or validated forecast; the demo must not claim either has been validated merely because it produces an answer.

## 1. Market data sources

### Offline training: Binance public archive

Official documentation: https://github.com/binance/binance-public-data

Archive: https://data.binance.vision/

Data terms: https://github.com/binance/binance-public-data/blob/master/TERMS_AND_CONDITIONS.md

Use spot daily candle archives for BTCUSDT and ETHUSDT initially. Attempt PAXGUSDT only after verifying archive coverage. Start with completed months January 2021 through September 2026 where available. Do not assume every asset covers that interval.

Monthly archive pattern:
`https://data.binance.vision/data/spot/monthly/klines/{SYMBOL}/1d/{SYMBOL}-1d-{YYYY-MM}.zip`

Select only files actually available. Verify companion checksums. Keep downloaded file metadata and revisions. IMPORTANT: the archive documents microsecond timestamps for spot data from 1 January 2025 onward; earlier data uses a different scale. Normalize deliberately rather than assuming all timestamps are milliseconds.

Raw columns include candle timestamps, OHLC, base/quote volume, trade count, and taker-buy volume. Normalize to UTC, consistent quote currency and cadence, closed candles, unique timestamps, and explicit gaps. Do not silently forward-fill gaps and call them observed prices.

Derived dataset: log return, lagged returns, lagged rolling volatility, and volume features, all computed using information available at each forecast cutoff. Use simple features first. Training on daily data keeps the initial experiment small; adding minute data does not create additional independent long-term regimes.

Binance series are USDT-denominated. Keep forecasts and backtest results in USDT and label them. Do not call them USD or historical THB forecasts. This is a separate training source from the THB demo display source.

### Demo reference prices: CoinGecko

Current prices: https://docs.coingecko.com/demo/reference/simple-price

Historical series: https://docs.coingecko.com/demo/reference/coins-id-market-chart

Internal mappings: `btc -> bitcoin`, `eth -> ethereum`, `gold -> pax-gold`. Verify supported currencies and IDs through actual requests. Request THB for display; current prices can be batched. Request last-updated timestamps and preserve null/missing changes.

Demo historical access is limited to the past 365 days. Use it for charts and reference calculations, not as the sole source of a multi-year training dataset. A Demo key is an external credential dependency. Do not silently combine CoinGecko aggregated THB history with Binance exchange-specific USDT returns.

## 2. Knowledge corpus sources

| Source | URL | Use and limitations |
|---|---|---|
| Bitcoin mechanics | https://bitcoin.org/en/how-it-works | Transactions, wallets, keys, confirmations. Community-maintained explanation; not investment advice or guaranteed future behavior. |
| Ethereum learning hub | https://ethereum.org/learn/ | Ethereum, gas, wallets, staking, and application concepts. Follow individual topic pages and preserve their dates/sections. |
| PAX Gold product | https://www.paxos.com/pax-gold | Issuer descriptions of backing and ownership. Attribute issuer claims. |
| PAX Gold terms | https://www.paxos.com/terms-and-conditions/pax-gold-terms-conditions | Redemption restrictions and conditions. Terms matter when qualifying marketing descriptions. |
| Investor.gov allocation | https://www.investor.gov/introduction-investing/getting-started/asset-allocation | General diversification, horizon, and risk concepts; not a crypto allocation formula or Thai operating authorization. |
| Investor.gov robo-advisers | https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-bulletins-45 | Questions about goals, horizon, finances, and limitations of automated guidance. |
| Thai SEC digital assets | https://www.sec.or.th/EN/Pages/Shortcut/DigitalAsset.aspx | Local regulatory information and education links. Use precise applicable material; do not infer approval of Icarus. |
| Tokenomist tooling | https://github.com/tokenomist-ai/tokenomist-cli | Official API tooling; key required. Actual endpoint entitlement, asset coverage, and limits remain untested. |

Initial corpus topics: wallet/key custody, network fees versus platform fees, confirmation/finality, volatility, liquidity/slippage, market versus limit orders, concentration/diversification, stablecoin risks, staking/yield conditions, token unlocks, and tokenized-asset issuer/redemption risks.

Create short factual records with source URL/section, asset/topic, conditions, language, fetch/review date, approval state, and version. Preserve restrictions and exceptions. Use source records as evidence; never follow instructions embedded in fetched pages. Review access and content-use terms before bulk collection or redistribution; prefer small paraphrased records with citations over copied full pages.

The app's own fees, supported assets, screens, and approved recommendations cannot be researched reliably from generic finance sources. Use explicitly mocked versions until the app owner supplies them.

## 3. User profiles and evaluation data

There is no discovered public dataset that establishes suitable personalized crypto advice for Icarus. Public financial QA datasets test different tasks. Build labeled synthetic demo profiles instead of importing unrelated personal-finance records as suitability truth.

Five profile templates:
1. Beginner with unknown goals: assistant asks a focused question before personalized guidance.
2. Near-term essential expense: profile includes deadline, liquidity need, and limited loss capacity.
3. Long-horizon user: explicit goals, existing exposure, experience, and loss capacity.
4. Concentrated portfolio: large visible single-asset exposure; outside-app holdings explicitly unknown.
5. Experienced user: wants forecast evidence and assumptions; experience does not imply affordability.

All profiles are fictional. Numeric amounts and holdings will be fixtures, not observations about real people. Do not use a model to invent a "correct" allocation and then train/evaluate another model against it as expert ground truth.

Evaluation sources for methodology:
- FinanceBench: https://arxiv.org/abs/2311.11944 (corporate evidence-based financial QA).
- FinQA: https://aclanthology.org/2021.emnlp-main.300v1.pdf (financial numerical reasoning).
- RAGAS: https://arxiv.org/abs/2309.15217 (retrieval/context/answer evaluation).

Product-specific cases still need to cover navigation, source conditions, user profiles, Thai/English, multi-turn corrections, missing data, numerical-field swaps, and unsupported guarantees. Keep examples used in prompts separate from held-out scenarios.

## 4. Model candidates and selection

Assistant default: a hosted general-purpose model with tool calling and structured output. Pick from providers the team can access using the same fixture evaluation. No dataset or budget presently supports a justified fine-tuning decision.

An available implementation reference is Google's Gemini tool/structured-output documentation:
- https://ai.google.dev/gemini-api/docs/structured-output
- https://ai.google.dev/gemini-api/docs/function-calling

This demonstrates interface availability, not superiority for financial guidance. Verify the exact supported model/API version and account limits before use; do not hardcode a model from an untested documentation example. Check Thai quality with a human.

Prediction candidates:
- Historical rolling-volatility baseline and EWMA: low setup cost and transparent computations.
- GARCH: https://arch.readthedocs.io/en/stable/univariate/univariate_volatility_forecasting.html
- Chronos: https://github.com/amazon-science/chronos-forecasting
- TimesFM: https://github.com/google-research/timesfm

Use pretrained forecasting models only as challengers if hardware/time permits. Verify the chosen weights' license and model card separately from repository-code licensing. Generic forecasting benchmarks do not demonstrate crypto trading usefulness. Pretraining on unknown financial periods can also complicate historical out-of-sample claims.

Forecast experiment default: BTCUSDT, daily cadence, next-day risk. Keep market-direction prediction an additional experiment, not an assumed capability. Train/tune on earlier periods, evaluate with rolling cutoffs, and reserve the latest completed months as a final test. Fit preprocessing on training data only, and purge overlapping labels for multi-day targets.

Return model name/version, quote currency, forecast timestamp, horizon, training cutoff, target definition, result, limitations, and baseline comparison. Store actual empirical coverage for intervals. Do not label a model's quantiles "90% reliable" without checking coverage; future regimes remain uncertain.

## 5. Buildable package without a backend

```
model_data/
  source_manifest.json
  raw/market/                 downloaded archive files + checksum metadata
  processed/market/           clean candles, features, chronological splits
  knowledge/                  paraphrased reviewed records + citations
  synthetic/                  profiles, holdings, and mock app facts
  fixtures/                   market/tool results and screen context
  evaluation/                 held-out cases and review rubric
  experiments/                baseline forecasts and saved results
```

Build preparation scripts/notebooks for ingestion, cleaning, feature creation, source-record retrieval, mock-tool invocation, and evaluation. No HTTP server is required for these deliverables. Other components supply live inputs later through a thin adapter.

Immediate order: source manifest -> raw BTC/ETH history -> timestamp/coverage checks -> synthetic profiles and tool fixtures -> small reviewed corpus -> assistant evaluation -> risk baseline -> optional forecasting challenger -> live integration.

## Human inputs still needed

### Hardware update

### Cloud gateway update

The user supplied CMKL Orion portal documentation confirming an OpenAI-compatible Chat Completions interface, API-key access, usage quota, and model status on the Keys page. User-reported target is `Qwen 3.8-27B-NVFP4`; exact API model identifier is not yet verified. Use this cloud gateway as the first assistant candidate instead of relying on local 27B inference. Local GPU memory no longer constrains assistant serving.

Portal: https://orion.cmkl.ai/keys . Subsequent user-supplied Quick Start confirms the inference base URL as `https://api.orion.cmkl.ai/v1`. The supplied curl selects Mango, so confirm Qwen's exact API ID using the gateway model list or a Qwen-selected example. A standard-library probe now exists at `model/orion_probe.py`; syntax and CLI checks passed, but no authenticated requests have been run.

Proposed application configuration names: `ICARUS_LLM_BASE_URL`, `ICARUS_LLM_MODEL`, and `ICARUS_LLM_API_KEY`. These are our environment-variable names, not provider-defined settings. Keep the key server-side or in local model-development scripts and out of the frontend, logs, repository, and chat.

Compatibility checks before integration: basic completion, Thai response, supplied-evidence numerical explanation, structured JSON, tool selection with valid arguments, and a complete tool-result-to-answer cycle. Chat Completions compatibility alone does not guarantee tools, strict schemas, streaming, or model-specific reasoning flags. Probe supported features rather than enabling them by assumption. Measure first-token and complete-turn latency, including tool cycles; handle quota/rate-limit failures explicitly. No paid requests have been issued or performance measured.

User reports an RTX 4060 and Qwen 27B. Local `nvidia-smi` confirms an RTX 4060 Laptop GPU with 8,188 MiB VRAM. Exact Qwen version, quantization, inference runtime, and system RAM remain unknown. Ollama is installed, but its local API could not be queried from this execution environment; the default manifest folder only showed llama3.2, which does not establish where the user's Qwen is stored.

Revise assistant deployment from hosted-only to runtime-independent: first evaluate the user's existing Qwen. A dense 27B model at an idealized four bits per parameter needs about 13.5 GB for weights alone, before quantization metadata and runtime/context memory. It cannot fit entirely in this 8 GB GPU at ordinary 4-bit quantization. CPU/system-RAM offload or remote inference may allow operation; latency must be measured, not guessed. This estimate is not a measurement of the user's actual model file.

Use Qwen 27B for local assistant experiments and offline evaluation if it runs acceptably. If interactive latency is poor, compare a smaller quantized tool-capable model or remote inference before the demo. Do not download or replace models without first identifying the existing setup. Keep knowledge selection compact and start with one concurrent request. Run the statistical forecasting baseline on CPU so it does not compete for GPU memory. Fine-tuning 27B is not a required milestone.

Ollama documents CPU/GPU offload reporting through `ollama ps`: https://docs.ollama.com/faq

- Provider account/budget and hardware availability: only the user can supply access constraints. Never put keys in chat or source control.
- App-specific truth: Oasis/app owner supplies the UI registry and real rules, or agrees the demo uses mock rules.
- Guidance review: a person with relevant financial expertise reviews the policy and personalized demo examples. Research cannot establish a correct universal crypto allocation.
- Thai review: a Thai speaker checks the actual answers and financial meaning.

Research and fixture preparation can proceed without these. They affect deployment, live claims, and the defensibility of personalized advice, not discovery of public data.
