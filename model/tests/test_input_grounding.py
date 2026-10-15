from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import json

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from input_grounding import monetary_mentions, validate_monetary_arguments
from assistant import answer, bound_amount_currencies


class InputGroundingTests(unittest.TestCase):
    def test_prefix_suffix_currency_and_grouped_amounts(self):
        for text in ("THB 1,000", "1000 baht", "1000 บาท"):
            self.assertEqual(bound_amount_currencies(text), {"THB"})
            validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, text, [])
        for text in ("USD 1000", "$1000", "1000 dollars"):
            self.assertEqual(bound_amount_currencies(text), {"USD"})
        self.assertEqual(monetary_mentions("Explain USDT and the year 2026"), [])

    def test_wrong_amount_or_currency_cannot_reach_calculator(self):
        for text in ("Fee on 5000 THB", "Fee on THB 5000", "Fee on 1000 USD"):
            with self.assertRaises(ValueError):
                validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, text, [])
        validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, "fee for that amount", [{"user":"1000 THB"}])
        with self.assertRaises(ValueError):
            validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, "actually 2000", [{"user":"1000 THB"}])
        with self.assertRaises(ValueError):
            validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, "actually 2000 THB", [{"user":"1000 THB"}])

    def test_historical_dates_cannot_be_invented(self):
        args = {"asset_id":"eth", "amount_usdt":"1000", "start_date":"2024-01-01", "end_date":"2026-09-30"}
        validate_monetary_arguments("what_if", args, "1000 USDT of ETH from 2024-01-01 to 2026-09-30", [])
        with self.assertRaises(ValueError):
            validate_monetary_arguments("what_if", {**args, "asset_id":"btc"}, "1000 USDT of ETH from 2024-01-01 to 2026-09-30", [])
        with self.assertRaises(ValueError):
            validate_monetary_arguments("what_if", args, "1000 USDT last year", [])
        with self.assertRaises(ValueError):
            validate_monetary_arguments("what_if", args, "1000 USDT from 2025-01-01 to 2026-09-30", [])

    def test_saved_budget_requires_explicit_reference(self):
        validate_monetary_arguments("calculate_fee", {"budget_thb":"5000"}, "fee on my budget", [], {"budget_thb":"5000"})
        with self.assertRaises(ValueError):
            validate_monetary_arguments("calculate_fee", {"budget_thb":"5000"}, "Explain fees", [], {"budget_thb":"5000"})

    def test_negative_amounts_and_unspaced_thai_cannot_change_meaning(self):
        validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, "งบ1000บาท", [])
        for text in ("-1000 THB", "THB -1000", "งบ-1000บาท"):
            with self.assertRaises(ValueError):
                validate_monetary_arguments("calculate_fee", {"budget_thb":"1000"}, text, [])

    def test_goal_amount_roles_cannot_be_swapped(self):
        text = "My target is 50000 THB; I already have 1000 THB; deadline 2027-06-15"
        args = {"target_thb":"50000", "current_thb":"1000", "target_date":"2027-06-15"}
        validate_monetary_arguments("goal_math", args, text, [])
        with self.assertRaises(ValueError):
            validate_monetary_arguments("goal_math", {**args, "target_thb":"1000", "current_thb":"50000"}, text, [])
        validate_monetary_arguments("goal_math", args, "เป้าหมาย50000บาท มีแล้ว1000บาท ถึง 2027-06-15", [])

    def test_model_wrong_budget_produces_error_without_wrong_financial_summary(self):
        count = 0
        def fake(model, messages, timings, **kwargs):
            nonlocal count
            count += 1
            if count == 1:
                return {"tool_calls":[{"id":"fee", "function":{"name":"calculate_fee", "arguments":'{"budget_thb":"1000"}'}}]}
            return {"content":json.dumps({"text":"Please confirm the amount to calculate.", "source_ids":[], "limitation_codes":["data_unavailable"]})}
        with patch("assistant.completion", side_effect=fake):
            result = answer("Explain fees on 5000 THB", model="fixture")
        self.assertEqual(next(iter(result["tool_results"].values()))["code"], "TOOL_AMOUNT_NOT_SUPPORTED_BY_USER_INPUT")
        self.assertNotIn("995.00", str(result["numerical_summaries"]))


if __name__ == "__main__":
    unittest.main()
