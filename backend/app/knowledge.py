"""Load the hand-written knowledge files in data/ and check they agree with each other."""
import json
from functools import cache

from app.config import DATA_DIR

ASSET_FIELDS = {"name", "name_th", "type", "tier", "source", "unit", "sell_hours",
                "aliases", "description_en", "description_th"}
TERM_FIELDS = {"en", "th", "aliases", "explain_en", "explain_th"}


def _load(name: str, data_dir=DATA_DIR) -> dict:
    return json.loads((data_dir / name).read_text(encoding="utf-8"))


@cache
def assets() -> dict:
    return _load("assets.json")


@cache
def fees() -> dict:
    return _load("fees.json")


@cache
def glossary() -> dict:
    return _load("glossary.json")["terms"]


@cache
def app_ui() -> dict:
    """The app Icarus can navigate: a read-only mirror of Oasis's prototype."""
    return _load("app_ui.json")


def ui_elements() -> dict:
    return app_ui()["elements"]


@cache
def journey() -> dict:
    return _load("journey.json")


def validate_knowledge(assets: dict, glossary: dict, ui_elements: dict, journey: dict) -> list[str]:
    """Returns a list of problems. Empty list means the files are consistent."""
    problems = []

    seen_aliases = {}
    for asset_id, a in assets.items():
        missing = ASSET_FIELDS - a.keys()
        if missing:
            problems.append(f"asset {asset_id}: missing {sorted(missing)}")
        if a.get("source") == "binance" and "symbol" not in a:
            problems.append(f"asset {asset_id}: binance asset needs a symbol")
        if a.get("source") == "fixed" and "price_usd" not in a:
            problems.append(f"asset {asset_id}: fixed asset needs price_usd")
        for alias in a.get("aliases", []):
            other = seen_aliases.setdefault(alias.lower(), asset_id)
            if other != asset_id:
                problems.append(f"alias '{alias}' used by both {other} and {asset_id}")

    for term_id, t in glossary.items():
        missing = TERM_FIELDS - t.keys()
        if missing:
            problems.append(f"term {term_id}: missing {sorted(missing)}")

    for element_id, e in ui_elements.items():
        for term_id in e.get("terms", []):
            if term_id not in glossary:
                problems.append(f"element {element_id}: unknown term '{term_id}'")

    for stage in journey["stages"]:
        step = journey["next_step"].get(stage)
        if step is None:
            problems.append(f"journey stage {stage}: no next_step")
        elif step["highlight"] is not None and step["highlight"] not in ui_elements:
            problems.append(f"journey stage {stage}: unknown element '{step['highlight']}'")

    return problems
