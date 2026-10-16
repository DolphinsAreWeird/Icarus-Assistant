import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant import answer


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


if __name__ == "__main__":
    unittest.main()
