from copy import deepcopy
from datetime import date, timedelta
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from market_validation import atomic_json, validate_daily_series, validate_forecast
from prepare_market_data import build_series, main
from icarus_core import history, ROOT


def january():
    return {str(date(2024, 1, 1)+timedelta(days=i)):
            {"date":str(date(2024, 1, 1)+timedelta(days=i)), "close":"10", "open":"10", "high":"11", "low":"9", "volume":"1"}
            for i in range(31)}


class MarketValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.test_root = ROOT/"results"/"test_tmp"
        cls.test_root.mkdir(parents=True, exist_ok=True)
    def test_missing_edges_or_internal_day_rejected(self):
        for day in ("2024-01-01", "2024-01-15", "2024-01-31"):
            rows = january()
            rows.pop(day)
            with self.assertRaises(ValueError):
                build_series("btc", rows, "2024-01", "2024-01", "test")

    def test_all_history_consumers_reject_false_identity_currency_and_prices(self):
        data = build_series("btc", january(), "2024-01", "2024-01", "test")
        for field, value in (("asset_id","eth"), ("currency","THB"), ("origin","synthetic")):
            wrong = {**data, field:value}
            with patch("icarus_core.read_json", return_value=wrong), patch("pathlib.Path.exists", return_value=True):
                with self.assertRaises(ValueError):
                    history("btc")
        for value in ("NaN", "Infinity", "0", "-10", "1e1000", "1e-1000"):
            wrong = deepcopy(data)
            wrong["points"][10]["close"] = value
            with self.assertRaises(ValueError):
                validate_daily_series(wrong)

    def test_atomic_failure_preserves_previous_artifact_and_cleans_temp(self):
        with tempfile.TemporaryDirectory(dir=self.test_root) as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(self.test_root.resolve()))
            path = Path(folder)/"report.json"
            atomic_json(path, {"old":True})
            with patch("market_validation.os.replace", side_effect=OSError("disk")):
                with self.assertRaises(OSError):
                    atomic_json(path, {"new":True})
            self.assertEqual(json.loads(path.read_text()), {"old":True})
            self.assertEqual(list(Path(folder).glob("*.tmp")), [])
            with self.assertRaises(ValueError):
                atomic_json(path, {"bad":float("nan")})
            self.assertEqual(json.loads(path.read_text()), {"old":True})

    def test_saved_forecast_rejects_wrong_identity_and_nonfinite_values(self):
        good = {"asset_id":"btc", "quote_currency":"USDT", "status":"experimental_historical_cutoff",
                "as_of":"2026-09-30", "rolling_20_next_day_volatility_pct":2, "ewma_094_next_day_volatility_pct":3}
        self.assertEqual(validate_forecast(good, "btc"), good)
        for field, value in (("asset_id","eth"), ("as_of","tomorrow"), ("quote_currency","THB"),
                             ("ewma_094_next_day_volatility_pct",float("nan")), ("return_interval",[])):
            with self.assertRaises(ValueError):
                validate_forecast({**good, field:value}, "btc")

    def test_failed_download_preserves_existing_series_and_reports_failure(self):
        with tempfile.TemporaryDirectory(dir=self.test_root) as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(self.test_root.resolve()))
            root = Path(folder)
            path = root/"data"/"market"/"btc.json"
            atomic_json(path, {"last_good":True})
            with patch("prepare_market_data.ROOT", root), patch("prepare_market_data.download", side_effect=OSError("offline")), patch(
                    "sys.argv", ["prepare_market_data.py", "--assets", "btc", "--start", "2024-01", "--end", "2024-01"]):
                with self.assertRaises(SystemExit):
                    main()
            self.assertEqual(json.loads(path.read_text()), {"last_good":True})
            manifest = json.loads((root/"data"/"market_manifest.json").read_text())
            self.assertEqual(len(manifest["failures"]), 1)


if __name__ == "__main__":
    unittest.main()
