"""Mock-up mode (ICARUS_MOCK=1): a live demo that answers the same way every time.

Three things make it deterministic:
1. Prices come from the saved snapshot (no live polling), so the grams and the fee never change between runs.
2. The legacy engine runs, and its fast path answers a buy request in code. It never calls a model for this.
3. canonical() cleans up what speech-to-text hears ("Hey Icarus, I want to buy a thousand bath of gold") into one
   fixed request, "buy 1000 baht of gold", so a slightly different transcript still lands on the same answer.

A request that isn't a plain buy of gold, Bitcoin or Ethereum is left alone and goes to the normal engine.
"""
import re

ASSETS = {"gold": r"gold|golds|paxg|pax gold", "bitcoin": r"bitcoin|btc", "ethereum": r"ethereum|ether|eth"}
BUY = re.compile(r"\b(?:buy|purchase|get|invest|put|order)\b")
NOT_A_BUY = re.compile(r"\b(?:sell|not|don't|dont|never|cancel|stop|if|should|maybe|how|what|why|compare)\b")
THOUSAND = re.compile(r"\b(?:a|one)?\s*thousand\b|\b1\s?k\b")
NUMBER = re.compile(r"\d+(?:\.\d+)?")


def canonical(text: str) -> str | None:
    """"buy 1000 baht of gold" if the message is a plain English request to buy one asset with a baht amount, else None."""
    t = text.lower().replace("’", "'")
    t = re.sub(r"(?<=\d),(?=\d{3}\b)", "", t)                # 1,000 -> 1000
    t = re.sub(r"\b(?:bath|bahts|baths|thb)\b|฿", "baht", t)
    t = THOUSAND.sub(" 1000 ", t)
    if not BUY.search(t) or NOT_A_BUY.search(t):
        return None
    assets = [name for name, words in ASSETS.items() if re.search(rf"\b(?:{words})\b", t)]
    amounts = NUMBER.findall(t)
    if len(assets) != 1 or len(amounts) != 1 or "baht" not in t:
        return None
    amount = float(amounts[0])
    if amount <= 0 or amount != int(amount):
        return None
    return f"buy {int(amount)} baht of {assets[0]}"
