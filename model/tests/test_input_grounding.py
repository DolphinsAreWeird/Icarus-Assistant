from pathlib import Path
import sys
import unittest
from unittest.mock import patch
import json
from datetime import date, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from input_grounding import monetary_mentions, validate_monetary_arguments, natural_calculation
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

    def test_clear_bilingual_numeric_requests_bypass_model(self):
        from icarus_core import ROOT, read_json
        from evaluate_assistant import structural_checks
        # Unit provider double: these tests must not require ignored downloads.
        def fake_history(asset):
            start, end = date(2024, 1, 1), date(2026, 9, 30)
            return {"asset_id":asset, "currency":"USDT", "origin":"real_historical",
                    "source_url":"https://example.org/unit-test-double",
                    "points":[{"date":str(start+timedelta(days=i)), "close":str(100+i)}
                              for i in range((end-start).days+1)]}
        for case in read_json(ROOT/"evaluation"/"numeric_cases.json"):
            with patch("assistant.completion", side_effect=AssertionError("Must not call model")), patch("icarus_core.history", side_effect=fake_history):
                result = answer(case["message"], language=case["lang"], today="2026-10-15")
            self.assertEqual(result["route"], "deterministic_natural_calculation", case["id"])
            self.assertTrue(all(structural_checks(case, result, live=True).values()), case["id"])

    def test_compound_or_incomplete_calculations_keep_model_planning(self):
        for message in ("Explain the mock fee on 1000 THB and recommend an allocation",
                        "Calculate a what-if for BTC and ETH with 1000 USDT from 2024-01-01 to 2026-09-30",
                        "Calculate a what-if for ETH with 1000 USDT from 2024-01-01 to 2026-09-30 including fees",
                        "Calculate monthly savings with 1000 THB until next June",
                        "What is the actual platform fee on 1000 THB?",
                        "Explain the mock platform fee on 1000 THB and explain wallets",
                        "Explain the mock platform fee on 1000 THB and say hello",
                        "ค่าธรรมเนียมจำลอง 1000 บาท แล้วควรลงทุนอะไร"):
            self.assertIsNone(natural_calculation(message), message)


if __name__ == "__main__":
    unittest.main()
