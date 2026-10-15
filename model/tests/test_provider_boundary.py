import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant import answer, LIMITATIONS


class ProviderBoundaryTests(unittest.TestCase):
    def test_invalid_provider_envelopes_return_fallback_instead_of_crashing(self):
        for envelope in (None, [], {}, {"choices":[]}, {"choices":[None]}, {"choices":[{}]},
                         {"choices":[{"message":"bad"}]}):
            with self.subTest(envelope=envelope), patch("assistant.request", return_value=(envelope, .01)):
                result = answer("Explain Bitcoin custody", model="fixture")
                self.assertEqual(result["status"], "needs_review")
                self.assertEqual(result["route"], "validation_fallback")

    def test_unreadable_local_history_is_an_explicit_data_error(self):
        with patch("icarus_core.history", side_effect=OSError("private path omitted")):
            result = answer("/history btc")
        self.assertEqual(result["status"], "data_unavailable")
        self.assertEqual(next(iter(result["tool_results"].values()))["code"], "LOCAL_DATA_READ_FAILED")
        self.assertNotIn("private path", json.dumps(result))

    def test_model_cannot_mislabel_source_backed_knowledge_as_synthetic_market_data(self):
        payload = {"text":"Physical redemption is subject to issuer eligibility and terms.", "source_ids":["paxg_terms"],
                   "limitation_codes":["draft_review", "historical_only", "synthetic_data", "saved_reference", "mock_account"]}
        with patch("assistant.completion", return_value={"content":json.dumps(payload)}):
            result = answer("Explain PAXG physical gold redemption", model="fixture")
        self.assertEqual(result["limitations"], [LIMITATIONS["draft_review"]["en"]])
        fee = answer("/fee 1000")
        self.assertIn(LIMITATIONS["mock_account"]["en"], fee["limitations"])


if __name__ == "__main__":
    unittest.main()
