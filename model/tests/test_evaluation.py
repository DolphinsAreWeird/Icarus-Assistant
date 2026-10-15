from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate_assistant import structural_checks, latency_summary
from session import ConversationSession
from icarus_core import ROOT, read_json
from assistant import answer, essential_funds_request, unsupported_tax_form_request, source_only_explanation
import json
from unittest.mock import patch


class EvaluationTests(unittest.TestCase):
    def test_all_sources_check_detects_partially_supported_answer(self):
        result = {"status":"ok", "ui_actions":[], "sources":[{"id":"a", "data":{}}]}
        case = {"expected_sources":["a","b"], "all_sources":True}
        self.assertFalse(structural_checks(case, result, live=True)["expected_sources"])
        case["all_sources"] = False
        self.assertTrue(structural_checks(case, result, live=True)["expected_sources"])

    def test_latency_uses_all_turns_and_separates_local_from_model(self):
        turns = [{"elapsed_seconds": seconds, "model_calls": calls}
                 for seconds, calls in ((0, []), (10, [{}]), (20, [{}]))]
        report = latency_summary([{"result":turns[-1], "turn_results":turns}])
        self.assertEqual(report["model"]["turns"], 2)
        self.assertEqual(report["model"]["median_seconds"], 15)
        self.assertEqual(report["local"]["turns"], 1)

    def test_bilingual_stress_corrections_reach_final_context(self):
        for case in read_json(ROOT / "evaluation" / "stress_cases.json"):
            if "turns" not in case:
                continue
            session = ConversationSession(language=case["lang"])
            for message in case["turns"]:
                result = session.ask(message, offline=True)
            checks = structural_checks(case, result, live=False)
            self.assertTrue(checks["expected_profile"], case["id"])
            self.assertTrue(checks["expected_sources"], case["id"])

    def test_current_tax_form_request_has_no_unverified_model_answer(self):
        for language, message in (("en", "Which exact Thai tax form must I file for crypto this year?"),
                                  ("th", "ปีนี้กำไรคริปโตต้องกรอกแบบภาษีไทยใบไหนแน่")):
            with patch("assistant.completion", side_effect=AssertionError("Must not call model")):
                result = answer(message, language=language)
            self.assertEqual(result["status"], "data_unavailable")
            self.assertEqual(result["route"], "unsupported_tax_evidence")
            self.assertEqual(result["sources"], [])
        self.assertFalse(unsupported_tax_form_request("Which Thai tax form and what is the fee?", []))
        self.assertFalse(unsupported_tax_form_request("Which Thai tax form? Also explain gas fees.", []))
        self.assertFalse(unsupported_tax_form_request("Which Thai tax form?", [{"topics":["tax"]}]))

    def test_focused_essential_funds_guidance_uses_corrected_context_without_model(self):
        for case in read_json(ROOT / "evaluation" / "stress_cases.json"):
            if "turns" not in case:
                continue
            session = ConversationSession(language=case["lang"])
            with patch("assistant.completion", side_effect=AssertionError("Must not call model")):
                for message in case["turns"]:
                    result = session.ask(message)
            self.assertEqual(result["route"], "essential_funds_guidance")
            self.assertEqual(result["model_calls"], [])
            self.assertTrue(structural_checks(case, result, live=True)["expected_profile"])
        evidence = {"goal_risk_fit": {}}
        profile = {"essential_money":True, "horizon_months":2}
        self.assertFalse(essential_funds_request("Should I buy BTC before I pay tuition and what is the fee?", profile, evidence))
        self.assertFalse(essential_funds_request("Should I buy BTC before I pay tuition, explain the fee too?", profile, evidence))
        self.assertFalse(essential_funds_request("Should I buy BTC before I pay tuition?", {}, evidence))
        self.assertFalse(essential_funds_request("Should I buy BTC before I pay tuition?", profile, {}))

    def test_conceptual_explanation_uses_json_mode_without_tools(self):
        def fake_completion(model, messages, timings, *, tools):
            self.assertIsNone(tools)
            return {"content":json.dumps({"text":"Network demand affects gas fees.",
                                           "source_ids":["network_fees"],"limitation_codes":[]})}
        with patch("assistant.completion", side_effect=fake_completion):
            result = answer("Why is sending ETH expensive when lots of people use it?", model="fixture")
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["tool_results"], {})
        self.assertFalse(source_only_explanation("Why is sending ETH expensive? Calculate the fee for 1000 THB."))
        self.assertFalse(source_only_explanation("If the exchange shuts down, compare my portfolio."))


if __name__ == "__main__":
    unittest.main()
