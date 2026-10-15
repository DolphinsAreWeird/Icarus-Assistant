import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from icarus_core import (fee_quote, goal_math, portfolio, load_profile, guidance_context,
                         retrieve, invoke, what_if, history, render_tool_data)
from prepare_market_data import normalize_row
from assistant import validate_final, validate_tool_currency, answer


class CoreTests(unittest.TestCase):
    def test_inclusive_fee_minimum_and_percentage(self):
        self.assertEqual(fee_quote("1000")["purchase_amount"],"995.00")
        self.assertEqual(fee_quote("4000")["fee"],"10.00")
        self.assertEqual(fee_quote("100")["purchase_amount"],"95.00")

    def test_nonfinite_negative_and_below_minimum(self):
        for amount in ("NaN","Infinity","-1","0","99","100.001"):
            with self.assertRaises(ValueError):
                fee_quote(amount)

    def test_month_end_schedule_and_target_already_met(self):
        result = goal_math("1000","0","2026-03-30","2026-01-31")
        self.assertEqual(result["contributions"],2)
        self.assertEqual(result["per_contribution"],"500.00")
        self.assertEqual(goal_math("1000","2000","2026-01-31","2026-01-31")["per_contribution"],"0.00")

    def test_same_day_and_past_deadline(self):
        self.assertEqual(goal_math("1000","0","2026-10-15","2026-10-15")["contributions"],1)
        with self.assertRaises(ValueError):
            goal_math("1000","0","2026-10-14","2026-10-15")

    def test_portfolio_denominator_includes_cash(self):
        result = portfolio(load_profile("concentrated"))
        self.assertEqual(result["total_including_cash"],"10000.00")
        self.assertEqual(next(p for p in result["positions"] if p["asset"]=="btc")["share_pct"],"80.00")
        self.assertEqual(result["origin"],"synthetic")

    def test_profile_gaps_and_essential_conflict(self):
        self.assertIn("goal",guidance_context(load_profile("new"))["missing_for_personalization"])
        self.assertTrue(guidance_context(load_profile("near_term"))["essential_near_term_conflict"])

    def test_retrieval_bilingual_and_asset_boundary(self):
        for question in ("gold redemption", "ทองแลก"):
            self.assertIn("paxg_terms",[r["id"] for r in retrieve(question,"th")])
        self.assertNotIn("btc_basics",[r["id"] for r in retrieve("monkey")])
        for question in ("What are fees?","What are wallets?","Explain transaction costs"):
            self.assertTrue(retrieve(question),question)
        self.assertIn("network_fees",[r["id"] for r in retrieve("ค่าธรรมเนียมเครือข่าย","th")])

    def test_no_execution_or_identity_argument(self):
        with self.assertRaises(ValueError):
            invoke("execute_trade",{},load_profile("new"),"2026-10-15")
        with self.assertRaises(ValueError):
            invoke("get_portfolio",{"user_id":"someone_else"},load_profile("new"),"2026-10-15")
        result = invoke("get_risk_forecast",{"asset_id":"D:/Uhackathon/model/data/profiles"},{},"2026-10-15")
        self.assertEqual(result["code"],"UNKNOWN_ASSET")

    def test_timestamp_unit_change(self):
        for timestamp in ("1704067200000","1704067200000000"):
            result = normalize_row([timestamp,"1","2","1","2","0"])
            self.assertEqual(result["date"],"2024-01-01")

    def test_numerical_and_source_validation(self):
        context = fee_quote("1000")
        validate_final({"text":"See the exact fee in the calculation below.","source_ids":["fee"],"limitation_codes":[]},{"fee":{}},context)
        with self.assertRaises(ValueError):
            validate_final({"text":"Fee 42 THB","source_ids":[],"limitation_codes":[]},{},context)
        with self.assertRaises(ValueError):
            validate_final({"text":"hello","source_ids":["fake"],"limitation_codes":[]},{},context)
        with self.assertRaises(ValueError):
            validate_final({"text":"hello","source_ids":[],"limitation_codes":["Guaranteed 999%"]},{},context)
        with self.assertRaises(ValueError):
            validate_final({"text":"Your fee is 1000 THB; your budget is 5 THB.","source_ids":[],"limitation_codes":[]},{},context)

    def test_fast_fee_never_calls_provider(self):
        result = answer("/fee 1000",language="th")
        self.assertEqual(result["model_calls"],[])
        self.assertIn("995.00",result["text"])
        self.assertEqual(answer("/fee 50",language="th")["status"],"invalid_input")
        for command in ("/fee -50","/fee 1000.123","/fee abc"):
            result = answer(command,language="en")
            self.assertEqual(result["status"],"invalid_input")
            self.assertEqual(result["model_calls"],[])
        for lang,message in (("en","What is the mock platform fee for a total budget of 1000 baht?"),
                             ("th","งบรวม 1000 บาท มีค่าธรรมเนียมแพลตฟอร์มจำลองเท่าไร")):
            result = answer(message,language=lang)
            self.assertEqual(result["route"],"deterministic_fee")
            self.assertEqual(result["model_calls"],[])

    def test_language_drift_is_flagged(self):
        with self.assertRaises(ValueError):
            validate_final({"text":"จำนวนเงินที่นำ去买","source_ids":[],"limitation_codes":[]},{},language="th")
        with self.assertRaises(ValueError):
            validate_final({"text":"Only English","source_ids":[],"limitation_codes":[]},{},language="th")

    def test_currency_substitution_is_blocked(self):
        with self.assertRaises(ValueError):
            validate_tool_currency("what_if","ซื้อ Bitcoin 1000 บาท",[])
        with self.assertRaises(ValueError):
            validate_tool_currency("calculate_fee","fee on 1000 USD",[])
        validate_tool_currency("what_if","1000 USDT of Bitcoin",[])
        with self.assertRaises(ValueError):
            validate_tool_currency("what_if","ตอนนี้ใช้ 1000 บาท",[{"user":"Previously 1000 USDT"}])
        with self.assertRaises(ValueError):
            validate_tool_currency("calculate_fee","What is the fee for that amount?",[{"user":"My budget is 1000 USD"}])
        with self.assertRaises(ValueError):
            validate_tool_currency("what_if","Now calculate it for 2000 dollars",[{"user":"Explain what USDT means"}])
        with self.assertRaises(ValueError):
            validate_tool_currency("what_if","Calculate it for 2000",[{"user":"Explain what USDT means"}])
        validate_tool_currency("calculate_fee","Actually use 1000 THB",[{"user":"My budget is 1000 USD"}])

    def test_real_history_when_present(self):
        try:
            data = history("btc")
        except ValueError:
            self.skipTest("No downloaded history")
        result = what_if("btc","1000",data["coverage_start"],data["coverage_end"])
        self.assertEqual(result["currency"],"USDT")
        self.assertFalse(result["fees_included"])
        self.assertEqual(data["gaps"],[])

    def test_compound_fee_question_is_not_short_circuited(self):
        count = 0
        def fake_completion(model,messages,timings,**options):
            nonlocal count
            count += 1
            if count == 1:
                return {"content":None,"tool_calls":[{"id":"call_fee","type":"function","function":{
                    "name":"calculate_fee","arguments":json.dumps({"budget_thb":"1000"})}}]}
            tool_reply = next(json.loads(message["content"]) for message in messages if message["role"]=="tool")
            return {"content":json.dumps({"text":"The fee calculation is below. What is your investment goal?",
                                          "source_ids":[tool_reply["result_id"]],"limitation_codes":["mock_account","missing_profile"]})}
        with patch("assistant.completion",side_effect=fake_completion):
            result = answer("Explain the fee and help decide whether this suits my goal.",model="fixture")
        self.assertEqual(count,2)
        self.assertEqual(result["status"],"ok")
        self.assertIn("goal",result["text"])
        self.assertIn("995.00",result["numerical_summaries"][0]["text"])

    def test_memory_retains_typed_fee_evidence(self):
        first = answer("/fee 1000")
        ref = first["sources"][0]["id"]
        response = {"content":json.dumps({"text":"The previous mock fee calculation is shown below.",
                    "source_ids":[ref],"limitation_codes":["mock_account"]})}
        memory = [{"user":"/fee 1000","assistant":first["text"],"sources":first["sources"]}]
        with patch("assistant.completion",return_value=response):
            follow_up = answer("What was the fee?",memory=memory,model="fixture")
        self.assertEqual(follow_up["status"],"ok")
        self.assertIn("5.00",follow_up["numerical_summaries"][0]["text"])

    def test_risk_summary_identifies_asset_and_historical_cutoff(self):
        data = {"asset_id":"btc","as_of":"2026-09-30","rolling_20_next_day_volatility_pct":2.2,
                "ewma_094_next_day_volatility_pct":2.1}
        for lang in ("en","th"):
            summary = render_tool_data("get_risk_forecast",data,lang)
            self.assertIn("Bitcoin",summary)
            self.assertIn("2026-09-30",summary)

    def test_explicit_data_commands_bypass_model(self):
        for lang in ("en","th"):
            result = answer("/portfolio",profile_id="concentrated",language=lang)
            self.assertEqual(result["route"],"deterministic_data_tool")
            self.assertEqual(result["model_calls"],[])
            self.assertIn("80.00%",result["numerical_summaries"][0]["text"])
        self.assertEqual(answer("/goal 50000 1000 THB 2027-06-15")["status"],"ok")
        self.assertEqual(answer("/goal 50000 1000 USD 2027-06-15")["status"],"invalid_input")
        self.assertEqual(answer("/whatif btc 1000 THB 2024-01-01 2026-09-30")["status"],"invalid_input")


if __name__ == "__main__":
    unittest.main()
