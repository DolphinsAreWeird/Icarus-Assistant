"""Copy only validated public model artifacts into this demo checkout; never .env."""
import argparse
import json
from pathlib import Path

from app.model_runtime import MODEL_DIR
from market_validation import atomic_json, validate_daily_series, validate_forecast


def prepare(source):
    source = Path(source).resolve()
    documents = []
    for asset in ("btc", "eth", "gold"):
        for folder, validate in (("market", validate_daily_series), ("forecasts", validate_forecast)):
            path = source / "data" / folder / f"{asset}.json"
            data = validate(json.loads(path.read_text(encoding="utf-8")), asset)
            documents.append((MODEL_DIR / "data" / folder / f"{asset}.json", data))
    # Validate every artifact before changing any destination.
    for path, data in documents:
        atomic_json(path, data)
    return len(documents)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", help="Path to the model/ folder containing public historical artifacts")
    args = parser.parse_args()
    print(f"Prepared {prepare(args.source)} validated historical demo artifacts. No credentials copied.")
