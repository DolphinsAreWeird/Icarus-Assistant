"""A trade preview must come from what the user asked, not from what the model decided.

The model may call prepare_trade, but the call only runs when the user's own words back all four
parts of it: a buy or sell intent, the same side, the same asset and the same amount in baht
(exact, decimals kept). Digits, commas, spelled amounts and Thai are read by checks.numbers_in_text.
A number that counts units of an asset ("2 bitcoin", "1 gram", "0.5 บิตคอยน์") is not an amount in baht.
Anything else comes back to the model as a tool error and nothing is previewed.

Multi-turn rule (conservative): the current message must itself carry a buy/sell word or an amount.
A part it does not state (intent, side, asset, amount) may be taken from the one user message just
before it ("I want to buy gold" then "1000 baht"). A part it does state must match the call.
An amount-only follow-up that is a question ("what is 1000 baht in grams?") is not a request.
"""
import re

from app import knowledge, ui
from app.assistant.checks import THAI, _number_spans, mentioned_assets

# present-tense requests only: "I bought gold last year" is not a request to buy
BUY = re.compile(r"\b(?:buy|purchase|invest|put|get|acquire|top up|set up|order)\b|ซื้อ|ลงทุน|เติม", re.IGNORECASE)
SELL = re.compile(r"\b(?:sell|cash out|liquidate)\b|ขาย", re.IGNORECASE)
NEGATED = re.compile(r"\b(?:don'?t|do not|dont|never|not|without)\b|ไม่|อย่า|ห้าม", re.IGNORECASE)
HYPOTHETICAL = re.compile(r"\b(?:what if|should i|would it|how much would|if i)\b|ถ้า|ควร", re.IGNORECASE)
QUESTION = re.compile(r"\b(?:what|how much|how many|why|when|which|explain|fees?|price|worth)\b"
                      r"|อะไร|เท่าไ[รห]|ยังไง|อย่างไร|ทำไม|ค่าธรรมเนียม|ราคา", re.IGNORECASE)
# a number followed by one of these counts units of an asset, not baht. The Thai gold weight
# ("ทอง 2 บาท") is left to the minimum-buy check: realistic weights are far below it.
QUANTITY_AFTER = re.compile(r"\s*(?:grams?\b|g\b|kg\b|kilos?\b|oz\b|ounces?\b|coins?\b|units?\b|shares?\b|"
                            r"tokens?\b|กรัม|กิโล|ออนซ์|เหรียญ|หน่วย|หุ้น)", re.IGNORECASE)

REFUSAL = {"ok": False, "reason": "trade_not_grounded", "no_action_executed": True,
           "message": ("No preview was made: the user's own message must ask to buy or sell this asset, side and "
                       "amount in baht. Do not guess. Ask the user which asset, side and amount they want.")}


def _sides(text: str) -> set[str]:
    return {s for s, rx in (("buy", BUY), ("sell", SELL)) if rx.search(text)}


def _assets(text: str) -> set[str]:
    """App ids the text names: by alias, or by the app's own id/name (XAU, Apple)."""
    found = set()
    for data_id in mentioned_assets(text, knowledge.assets()):
        app_id = ui.to_app_asset(data_id)
        if app_id:
            found.add(app_id)
    for app_id, a in knowledge.app_ui()["assets"].items():
        if re.search(rf"\b(?:{re.escape(app_id)}|{re.escape(a['name'])})\b", text, re.IGNORECASE):
            found.add(app_id)
    return found


def _asset_words() -> list[str]:
    words = [alias.lower() for a in knowledge.assets().values() for alias in a["aliases"]]
    return words + [w.lower() for app_id, a in knowledge.app_ui()["assets"].items() for w in (app_id, a["name"])]


def _is_quantity(rest: str) -> bool:
    """True when the words right after a number count units of an asset ("2 bitcoin"), not baht."""
    if QUANTITY_AFTER.match(rest):
        return True
    rest = rest.lstrip().lower()
    return any(rest.startswith(w) and (THAI.search(w) or not re.match(r"\w", rest[len(w):len(w) + 1]))
               for w in _asset_words())  # Thai has no spaces: "ทอง" also starts "ทองคำ"


def _amounts(text: str) -> set[float]:
    return {round(v, 6) for _, end, v, _ in _number_spans(text) if not _is_quantity(text[end:])}


def check(args: dict, text: str, previous: str | None = None, here: str | None = None) -> dict | None:
    """None when the user's words back this prepare_trade call, else the tool error to return."""
    try:
        side = args["side"]
        asset = ui.to_app_asset(args["asset_id"])
        amount = args["amount_thb"]
        if isinstance(amount, bool) or not isinstance(amount, (int, float)) or side not in ("buy", "sell") or not asset:
            return REFUSAL
        amount = round(float(amount), 6)
    except (KeyError, TypeError):
        return REFUSAL
    if NEGATED.search(text) or HYPOTHETICAL.search(text):
        return REFUSAL
    now_sides, now_assets, now_amounts = _sides(text), _assets(text), _amounts(text)
    if not now_sides and (not now_amounts or QUESTION.search(text)):
        return REFUSAL  # nothing in this message asks for a trade
    before = previous or ""
    if before and (NEGATED.search(before) or HYPOTHETICAL.search(before)):
        before = ""
    sides = now_sides or _sides(before)
    assets = now_assets or _assets(before) or ({here} if here else set())
    amounts = now_amounts or _amounts(before)
    if sides != {side} or assets != {asset} or amount not in amounts:
        return REFUSAL
    return None
