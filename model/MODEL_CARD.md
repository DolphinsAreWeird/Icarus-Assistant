# Modelling checkpoint — 16 October 2026

The assistant uses the existing cloud Qwen model with bilingual evidence retrieval, explicit user context, and deterministic financial tools. No Qwen fine-tuning has been performed. The prediction component is a separate statistical experiment on daily market returns; the LLM explains its saved output rather than calculating predictions itself.

## Prediction inputs and evaluation

BTCUSDT, ETHUSDT and PAXGUSDT each contain 1,004 daily observations from 2024-01-01 through 2026-09-30. Inputs come from checksum-verified Binance public archives. PAXG is an exchange-traded gold token, not a physical-gold spot index. USDT returns are not THB returns. Input currency, daily continuity, positive finite closes and coverage metadata are checked before the interval experiment runs.

The two interval candidates are empirical quantiles of the previous 250 daily log returns, and quantiles of previous volatility-standardized innovations scaled by the current causal EWMA volatility. EWMA decay is fixed at 0.94 with a 20-day initialization. These settings were specified before running this experiment, rather than searched on the final test period. Neither candidate predicts a profitable trade or a personalized allocation.

| Period | Target dates | Returns | Purpose |
|---|---|---:|---|
| Initial history | 2024-01-02 to 2025-05-16 | 501 | Initialize rolling estimates |
| Model selection | 2025-05-17 to 2025-10-13 | 150 | Choose the candidate with the lowest central interval score |
| Calibration | 2025-10-14 to 2026-03-13 | 151 | Determine a nonnegative interval expansion |
| Test | 2026-03-14 to 2026-09-30 | 201 | Evaluate the frozen selection and expansion |

Each forecast uses only preceding returns. During evaluation, newly observed returns update subsequent rolling estimates, as they would in walk-forward operation. They never change the selected candidate or calibration expansion. The calibration expansion uses the finite-sample order statistic of outside-interval errors. Temporal dependence, changing regimes, and adaptive estimates prevent an automatic exchangeability-based coverage guarantee. The target is nominal 90% coverage, not a guaranteed probability or maximum loss.

The test window was already used in the earlier variance-baseline experiment. It is held out from this implementation's candidate selection and calibration, but is not a permanently unseen research benchmark. Further design changes need a new forward evaluation period before claiming generalization.

## Observed results

Results below were calculated on the local real archive data. Scores and widths are in percentage log-return units; lower interval score is better. Intervals displayed to users convert endpoints to simple percentage returns.

| Asset | Candidate selected on earlier data | Calibrated test coverage | Mean interval width | Calibrated interval score | Uncalibrated rolling reference score |
|---|---|---:|---:|---:|---:|
| BTC | EWMA-scaled quantiles | 91.04% | 7.0700 | 9.7082 | 9.6134 |
| ETH | Rolling quantiles | 95.02% | 11.0113 | 13.9423 | 13.8034 |
| PAXG | EWMA-scaled quantiles | 89.05% | 4.4361 | 6.3815 | 6.3726 |

The selected calibrated forecasts did not beat the uncalibrated rolling reference on test interval score. PAXG missed the nominal coverage target. ETH achieved higher coverage using relatively wide ranges; coverage alone is not a quality verdict. Keep this as an experimental explanatory feature, not evidence of trading advantage. No candidate was reselected after seeing these results.

At the saved cutoff of 2026-09-30, the estimated intervals for the following day were BTC −3.2444% to +3.7940%, ETH −4.7837% to +5.2283%, and PAXG −2.0364% to +1.6118%. These are historical-cutoff outputs, not forecasts for today's market. Actual returns may fall outside the range.

Full generated artifacts include input SHA-256, split dates, parameters, selection metrics, calibration rank and test metrics. They remain in ignored `data/forecasts/`; download and regenerate them on another machine. This document records a checkpoint, not an automatically refreshed report.

## Assistant knowledge evaluation

The corpus now has 12 English/Thai records, including price impact, slippage protections, platform custody risk and stablecoin mechanics. Every new record carries a primary source URL, section, checking date and draft review status. Protocol examples do not establish Icarus execution behavior, and US risk education does not establish Thai legal protections. Live data availability comes from runtime adapters, not static knowledge claims.

The 28-query development set includes 11 supported questions and 3 negative questions in each language. Expected-record recall at five is 100% in both languages. Mean reciprocal rank is 1.0000 in English and 0.9545 in Thai. All six negative questions return no records. These are small curated regression examples that share vocabulary with the corpus; they do not measure broad paraphrase robustness, factual correctness or advice quality. Structural source validation does not prove that every generated claim is entailed by its citation.

All 54 automated tests pass. Four live Orion cases for slippage and stablecoin questions passed complete-answer, source-ID and no-execution structural checks in English and Thai. Observed request times were 6.689, 18.747, 16.774 and 18.968 seconds respectively. Text inspection found the intended distinctions, but this is not a human language or financial review. The initial sandboxed attempt failed to connect; the network-enabled retry completed. Generated run files remain in ignored `results/` with human review pending.

## Reproduce

From the repository root, using Python's standard library:

```powershell
python -m unittest discover -s model/tests -v
python model/evaluate_retrieval.py
python model/prepare_market_data.py --help
# If local history is missing, run the downloader with the intended date range first.
python model/predict_risk.py --asset all
python model/assistant.py '/risk btc' --lang en
python model/assistant.py '/risk btc' --lang th
python model/evaluate_assistant.py --live --ids slippage_en slippage_th stablecoin_en stablecoin_th
```

The final command consumes Orion quota using the existing local environment configuration. Tests include future-shock leakage checks, frozen model selection/calibration, chronological partition and date mapping checks, metadata rejection, source-label consistency and bilingual rendering compatibility.

## Remaining modelling work

- Evaluate broader independently written Thai/English paraphrases, unsupported factual requests, adversarial prompts and multi-turn contradictions. Measure semantic grounding and refusal quality, not only source-ID validity.
- Repeat forecast evaluation across several historical regimes and a genuinely new forward period. Add better candidates only with an explicit target and improvement criterion; retain the simple reference.
- Decide whether the demo needs a current forecast. If so, refresh completed daily candles through the required cutoff and rerun the pipeline; never relabel the saved historical artifact as current.
- Luka and First still need to review Thai wording, source meaning and financial guidance examples. Their review can run alongside development.
- Latency remains variable for open-ended Qwen explanations. Deterministic factual commands avoid requests, but voice responsiveness is not established by that shortcut.

No backend, transaction execution, authentication or frontend work is included in this checkpoint.

## Method and knowledge sources

Chronological evaluation follows the principle described in [TimeSeriesSplit documentation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html). The calibration order-statistic construction is informed by [Angelopoulos and Bates](https://arxiv.org/abs/2107.07511); its usual validity assumptions must not be silently carried over to dependent market data.

New knowledge uses [Uniswap price-impact education](https://support.uniswap.org/hc/en-us/articles/8671539602317-What-is-price-impact), [Uniswap swap protection documentation](https://developers.uniswap.org/docs/get-started/concepts/traders/swaps), [Investor.gov's crypto risk alert](https://www.investor.gov/introduction-investing/general-resources/news-alerts/alerts-bulletins/investor-alerts/crypto-asset-securities), and [Ethereum stablecoin education](https://ethereum.org/stablecoins/). Interpretive integration boundaries are explicitly identified as prototype policy in the records.
