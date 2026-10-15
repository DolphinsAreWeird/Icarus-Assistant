"""Measure curated bilingual retrieval coverage, independently of LLM prose."""
import json
from icarus_core import ROOT, read_json, retrieve


def evaluate(cases=None):
    cases = cases if cases is not None else read_json(ROOT / "evaluation" / "retrieval_cases.json")
    rows = []
    for case in cases:
        ids = [record["id"] for record in retrieve(case["query"], case["lang"])]
        expected = set(case["expected_ids"])
        ranks = [ids.index(ref)+1 for ref in expected if ref in ids]
        rows.append({**case, "retrieved_ids": ids,
                     "all_expected_at_5": expected.issubset(ids) if expected else not ids,
                     "first_relevant_rank": min(ranks) if ranks else None,
                     "recall_at_5": len(expected.intersection(ids))/len(expected) if expected else None})
    groups = {}
    for language in ("en", "th"):
        positive = [row for row in rows if row["lang"] == language and row["expected_ids"]]
        negative = [row for row in rows if row["lang"] == language and not row["expected_ids"]]
        groups[language] = {"supported_queries": len(positive),
                            "mean_recall_at_5": sum(r["recall_at_5"] for r in positive)/len(positive) if positive else None,
                            "mean_reciprocal_rank_at_5": sum(1/r["first_relevant_rank"] if r["first_relevant_rank"] else 0 for r in positive)/len(positive) if positive else None,
                            "negative_queries": len(negative),
                            "negative_empty_count": sum(not r["retrieved_ids"] for r in negative)}
    return {"status": "curated_development_set_not_independent_benchmark", "by_language": groups,
            "failures": [row["id"] for row in rows if not row["all_expected_at_5"]], "results": rows}


if __name__ == "__main__":
    report = evaluate()
    target = ROOT / "results" / "retrieval.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("status", "by_language", "failures")}, indent=2))
    raise SystemExit(bool(report["failures"]))
