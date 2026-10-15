from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from profile_context import extract_explicit_updates,validate_updates
from session import ConversationSession,session_path
from assistant import answer


class SessionTests(unittest.TestCase):
    def test_english_explicit_intake(self):
        parsed = extract_explicit_updates("My goal is retirement; My horizon is 5 years; This money is not essential; My loss capacity is moderate; My risk preference is low")
        self.assertEqual(parsed["updates"],{"goal":"retirement","horizon_months":60,"essential_money":False,"loss_capacity":"moderate","risk_preference":"low"})
        self.assertEqual(parsed["unrecognized"],[])

    def test_thai_explicit_intake(self):
        parsed = extract_explicit_updates("เป้าหมายคือออมระยะยาว; ระยะเวลาลงทุน 5 ปี; เงินนี้ไม่ใช่เงินจำเป็น; ความสามารถรับผลขาดทุนคือปานกลาง; ความเต็มใจรับความเสี่ยงคือต่ำ")
        self.assertEqual(parsed["updates"]["horizon_months"],60)
        self.assertFalse(parsed["updates"]["essential_money"])
        self.assertEqual(parsed["updates"]["risk_preference"],"low")

    def test_hypothetical_negated_and_ambiguous_not_inferred(self):
        for text in ("If my horizon is 5 years, what happens?","My horizon is not 5 years","Maybe my risk preference is high","I am rich","ฉันไม่แน่ใจว่าจะลงทุนได้ 5 ปีไหม",
                     "For a hypothetical person; My risk preference is high","สมมติว่าเป็นตัวอย่าง; ความเต็มใจรับความเสี่ยงคือสูง",
                     '"My goal is retirement; My risk preference is high; My horizon is 5 years"'):
            self.assertEqual(extract_explicit_updates(text)["updates"],{},text)

    def test_compound_goal_request_is_not_swallowed(self):
        for message in ("My goal is retirement and should I buy Bitcoin?","My goal is retirement, compare Bitcoin and gold.","เป้าหมายคือออมระยะยาว ควรซื้อ Bitcoin ไหม"):
            state = ConversationSession()
            with patch("assistant.answer",return_value={"text":"fixture answer","sources":[],"tool_results":{}}) as called:
                state.ask(message)
                self.assertEqual(called.call_args.args[0],message)
                self.assertIsNone(state.profile["goal"])

    def test_latest_correction_has_provenance(self):
        state = ConversationSession()
        state.ask("My horizon is 5 years",offline=True)
        state.ask("Actually, my horizon is 3 months",offline=True)
        self.assertEqual(state.profile["horizon_months"],3)
        self.assertIn("Actually",state.provenance["horizon_months"]["source_quote"])
        self.assertEqual(state.provenance["horizon_months"]["turn"],2)

    def test_no_model_for_complete_profile_updates(self):
        state = ConversationSession()
        result = state.ask("My goal is retirement; My horizon is 5 years; This money is not essential; My loss capacity is moderate; My risk preference is moderate")
        self.assertEqual(result["route"],"profile_update")
        self.assertEqual(result["model_calls"],[])
        self.assertEqual(result["guidance_context"]["missing_for_personalization"],[])

    def test_unknown_or_invalid_fields_cannot_change_holdings(self):
        state = ConversationSession("concentrated")
        original = state.profile["positions_thb"]
        for message in ("/set positions_thb hacked","/set horizon_months -1","/set essential_money perhaps"):
            self.assertEqual(state.ask(message)["status"],"invalid_input")
        self.assertEqual(state.profile["positions_thb"],original)

    def test_field_clear_restores_missing_not_seed_guess(self):
        state = ConversationSession("long_term")
        state.ask("/set horizon_months null")
        self.assertIsNone(state.profile["horizon_months"])
        self.assertIn("horizon_months",state.ask("/profile")["guidance_context"]["missing_for_personalization"])

    def test_language_switch_and_reset(self):
        state = ConversationSession()
        state.ask("/set goal retirement")
        state.ask("/lang th")
        self.assertEqual(state.language,"th")
        state.ask("/reset")
        self.assertEqual(state.updates,{})
        self.assertEqual(state.memory,[])
        self.assertEqual(state.language,"th")

    def test_persistence_is_opt_in_and_round_trips(self):
        state = ConversationSession()
        state.ask("My goal is retirement")
        test_root = Path(__file__).resolve().parents[1]/"results"
        test_root.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(dir=test_root) as tmp:
            self.assertTrue(Path(tmp).resolve().is_relative_to(test_root.resolve()))
            target = Path(tmp)/"session_demo.json"
            with patch("session.session_path",return_value=target):
                state.save("demo")
                loaded = ConversationSession.load("demo")
            self.assertEqual(loaded.profile["goal"],"retirement")
            self.assertEqual(loaded.provenance,state.provenance)

    def test_session_names_cannot_escape_storage(self):
        for name in ("../secret","D:/somewhere","x/y","","x"*65):
            with self.assertRaises(ValueError):
                session_path(name)

    def test_model_sees_current_profile_and_correction(self):
        captured = []
        def fake_completion(model,messages,timings,**options):
            captured.append(json.loads(messages[0]["content"]))
            return {"content":json.dumps({"text":"Your stated horizon and constraints are available for this comparison.","source_ids":[],"limitation_codes":["draft_review"]})}
        state = ConversationSession()
        state.ask("My goal is retirement; My horizon is 5 years; This money is not essential; My loss capacity is moderate; My risk preference is moderate")
        with patch("assistant.completion",side_effect=fake_completion):
            result = state.ask("Compare the trade-offs.",model="fixture")
        self.assertEqual(captured[-1]["profile"]["horizon_months"],60)
        self.assertEqual(captured[-1]["guidance_context"]["missing_for_personalization"],[])
        self.assertEqual(result["profile_origin"],"synthetic_seed_with_user_stated_context")


if __name__ == "__main__":
    unittest.main()
