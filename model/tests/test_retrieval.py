from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate_retrieval import evaluate
from icarus_core import ROOT, read_json, retrieve


class RetrievalTests(unittest.TestCase):
    def test_curated_supported_and_unsupported_queries(self):
        report = evaluate()
        self.assertEqual(report["failures"], [])
        self.assertEqual(len(report["results"]), 28)

    def test_case_labels_exist_in_corpus_and_language_pairs_share_evidence(self):
        records = read_json(ROOT / "knowledge" / "records.json")
        ids = [row["id"] for row in records]
        self.assertEqual(len(ids), len(set(ids)))
        cases = read_json(ROOT / "evaluation" / "retrieval_cases.json")
        for case in cases:
            self.assertTrue(set(case["expected_ids"]).issubset(ids))
            if case["lang"] == "en":
                partner = next(row for row in cases if row["id"] == case["id"][:-3]+"_th")
                self.assertEqual(case["expected_ids"], partner["expected_ids"])
        for row in records:
            self.assertTrue(row["en"] and row["th"] and row["review_status"] and row["checked_on"])

    def test_retrieval_scores_all_required_records_not_just_one(self):
        report = evaluate([{"id": "missing", "query": "slippage", "lang": "en",
                            "expected_ids": ["execution_slippage", "paxg_terms"]}])
        self.assertEqual(report["failures"], ["missing"])
        self.assertEqual(report["results"][0]["recall_at_5"], .5)
        self.assertEqual(retrieve("monkey keyboard"), [])

    def test_everyday_paraphrases_and_noncrypto_fee_gas_disambiguation(self):
        cases = read_json(ROOT / "evaluation" / "retrieval_challenge.json")
        self.assertEqual(evaluate(cases)["failures"], [])
        # Explicit crypto comparisons survive the narrow non-crypto scope gate.
        self.assertIn("network_fees", [r["id"] for r in retrieve("Compare car fuel and Ethereum gas fees")])
        self.assertIn("goal_risk_fit", [r["id"] for r in retrieve("Can Bitcoin help me grow this before I pay?")])


if __name__ == "__main__":
    unittest.main()
