import math
from datetime import date, timedelta
from pathlib import Path
import random
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from forecast_intervals import (candidate_predictions, evaluate_returns, quantile,
                                calibration_expansion, interval_score, experiment)
from icarus_core import render_tool_data


class ForecastTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        rng = random.Random(714)
        cls.returns = [rng.gauss(0, .02 if i < 650 else .045) for i in range(800)]

    def test_future_shock_cannot_change_prior_predictions(self):
        original = candidate_predictions(self.returns)
        shocked = candidate_predictions(self.returns[:500]+[.8]*300)
        prefix = candidate_predictions(self.returns[:500])
        for name in original:
            for index in range(270, 501):
                self.assertEqual(original[name][index], shocked[name][index])
                self.assertEqual(original[name][index], prefix[name][index])
            self.assertNotEqual(original[name][501], shocked[name][501])

    def test_test_outcomes_cannot_change_selection_or_calibration(self):
        original = evaluate_returns(self.returns)
        start = original["split_indices"]["test"][0]
        shocked = evaluate_returns(self.returns[:start]+[.5]*(800-start))
        for key in ("selected_candidate", "selection_metrics", "calibration"):
            self.assertEqual(original[key], shocked[key])
        self.assertNotEqual(original["test_metrics"], shocked["test_metrics"])

    def test_calibration_outcomes_cannot_change_model_selection(self):
        original = evaluate_returns(self.returns)
        start = original["split_indices"]["calibration"][0]
        shocked = evaluate_returns(self.returns[:start]+[.3]*(800-start))
        self.assertEqual(original["selection_metrics"], shocked["selection_metrics"])
        self.assertEqual(original["selected_candidate"], shocked["selected_candidate"])

    def test_partitions_are_disjoint_and_cover_all_targets(self):
        report = evaluate_returns(self.returns)
        periods = list(report["split_indices"].values())
        self.assertEqual(periods[0][0], 0)
        self.assertEqual(periods[-1][1], len(self.returns))
        for (_, stop), (start, _) in zip(periods, periods[1:]):
            self.assertEqual(stop, start)
        self.assertEqual(report["test_metrics"]["selected_calibrated"]["observations"], 160)

    def test_constant_returns_and_calibration_rank(self):
        report = evaluate_returns([0.0]*600)
        self.assertEqual(report["next_day_simple_return_interval_pct"], {"lower": 0.0, "upper": 0.0})
        self.assertEqual(report["test_metrics"]["selected_calibrated"]["empirical_coverage_pct"], 100)
        self.assertEqual(calibration_expansion(list(range(19))), 17)
        with self.assertRaises(ValueError):
            calibration_expansion([0])
        self.assertEqual(quantile([0, 10], .5), 5)
        self.assertEqual(interval_score(-1, 1, 0), 2)
        self.assertEqual(interval_score(-1, 1, 2), 22)

    def test_missing_history_and_nonfinite_values_fail(self):
        with self.assertRaises(ValueError):
            evaluate_returns([0]*599)
        for value in (math.nan, math.inf):
            with self.assertRaises(ValueError):
                evaluate_returns(self.returns[:-1]+[value])

    def test_report_dates_and_input_hash_follow_target_observations(self):
        points = [{"date": str(date(2024, 1, 1)+timedelta(days=i)), "close": "100"}
                  for i in range(601)]
        data = {"points": points, "currency": "USDT", "coverage_start": points[0]["date"],
                "coverage_end": points[-1]["date"]}
        report = experiment(data)
        self.assertEqual(report, experiment(data))
        self.assertEqual(report["split_dates"]["model_selection"]["first_target_date"], points[301]["date"])
        self.assertEqual(report["split_dates"]["calibration"]["last_target_date"], points[480]["date"])
        self.assertEqual(report["split_dates"]["test"]["first_target_date"], points[481]["date"])
        self.assertEqual(report["split_dates"]["test"]["last_target_date"], points[600]["date"])
        points[-1]["close"] = "101"
        self.assertNotEqual(report["input_sha256"], experiment(data)["input_sha256"])

    def test_invalid_history_metadata_cannot_be_labeled_daily_usdt(self):
        from copy import deepcopy
        points = [{"date": str(date(2024, 1, 1)+timedelta(days=i)), "close": "100"}
                  for i in range(601)]
        data = {"points": points, "currency": "USDT", "coverage_start": points[0]["date"],
                "coverage_end": points[-1]["date"]}
        mutations = [lambda d: d.update(currency="THB"),
                     lambda d: d.update(coverage_end="2099-01-01"),
                     lambda d: d.update(coverage_start="2023-12-31"),
                     lambda d: d["points"][40].update(date=d["points"][39]["date"]),
                     lambda d: d["points"].pop(40),
                     lambda d: d["points"].reverse(),
                     lambda d: d["points"][40].update(close="0")]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                invalid = deepcopy(data)
                mutate(invalid)
                with self.assertRaises(ValueError):
                    experiment(invalid)

    def test_renderer_supports_old_and_new_artifacts_in_both_languages(self):
        data = {"asset_id": "btc", "as_of": "2026-09-30",
                "rolling_20_next_day_volatility_pct": 2, "ewma_094_next_day_volatility_pct": 3}
        for language in ("en", "th"):
            old = render_tool_data("get_risk_forecast", data, language)
            data["return_interval"] = evaluate_returns(self.returns)
            new = render_tool_data("get_risk_forecast", data, language)
            self.assertIn("2026-09-30", new)
            self.assertIn("90.0%", new)
            self.assertGreater(len(new), len(old))
            data.pop("return_interval")

    def test_renderer_discloses_no_improvement_on_reference(self):
        data = {"asset_id":"btc", "as_of":"2026-09-30", "rolling_20_next_day_volatility_pct":0,
                "ewma_094_next_day_volatility_pct":0, "return_interval":evaluate_returns([0.0]*600)}
        self.assertIn("did not beat", render_tool_data("get_risk_forecast", data, "en"))
        self.assertIn("ไม่ดีกว่า", render_tool_data("get_risk_forecast", data, "th"))


if __name__ == "__main__":
    unittest.main()
