"""Plain-code checks around the model: before (language, assets mentioned) and
after (every number in the reply must come from a tool result or the user)."""
import re

THAI = re.compile(r"[฀-๿]")
NUMBER = re.compile(r"(?<![\w.])-?\d[\d,]*(?:\.\d+)?(?:\s*(million|ล้าน|billion|k)\b)?",
                    re.IGNORECASE)
MULTIPLIER = {"million": 1e6, "ล้าน": 1e6, "billion": 1e9, "k": 1e3}
ALWAYS_OK_MAX = 10       # counting words like "2 steps" or "3 sentences"
TOLERANCE = 0.03         # "about 142,700" for 142,712.36 is fine


def detect_language(text: str, fallback: str = "en") -> str:
    return "th" if THAI.search(text) else fallback


def mentioned_assets(text: str, assets: dict) -> list[str]:
    """Asset ids the text names, by alias. English aliases match whole words;
    Thai has no spaces, so Thai aliases match anywhere."""
    lower = text.lower()
    found = []
    for asset_id, a in assets.items():
        for alias in a["aliases"]:
            alias = alias.lower()
            hit = (alias in lower) if THAI.search(alias) else \
                re.search(rf"\b{re.escape(alias)}\b", lower) is not None
            if hit:
                found.append(asset_id)
                break
    return found


def numbers_in_text(text: str) -> list[tuple[float, int]]:
    """Numbers with their decimal places: "1,000" -> (1000.0, 0), "0.22 g" -> (0.22, 2)."""
    out = []
    for m in NUMBER.finditer(text):
        raw = m.group(0)
        word = m.group(1)
        digits = raw[: m.start(1) - m.start(0)].strip() if word else raw
        value = float(digits.replace(",", ""))
        decimals = len(digits.split(".")[1]) if "." in digits else 0
        if word:
            value *= MULTIPLIER[word.lower()]
            decimals = -6  # "2.7 million" is rounded on purpose
        out.append((value, decimals))
    return out


def numbers_in(obj) -> set[float]:
    """Every number inside a tool result, including numbers inside strings like dates."""
    found = set()
    if isinstance(obj, bool) or obj is None:
        return found
    if isinstance(obj, (int, float)):
        found.add(float(obj))
    elif isinstance(obj, str):
        found |= {v for v, _ in numbers_in_text(obj)}
    elif isinstance(obj, dict):
        for v in obj.values():
            found |= numbers_in(v)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            found |= numbers_in(v)
    return found


PERCENT_AFTER = re.compile(r"\s*(%|percent|per cent|เปอร์เซ็นต์)", re.IGNORECASE)
TIME_WORD_AFTER = re.compile(r"\s*(h\b|hours?|hrs?|ชั่วโมง|ชม)", re.IGNORECASE)  # "24 hours" is a label

ADVICE_PATTERNS = [
    r"what (should|do you think) i (buy|sell|invest)", r"should i (buy|sell|hold|invest)",
    r"good time to (buy|sell|invest)", r"(is|are) .{1,30} a good (buy|investment|idea)",
    r"(best|better) (coin|asset|investment|thing to buy|crypto)", r"recommend",
    r"which (one|coin|asset) (should|to)", r"will .{1,30} go (up|down)",
    r"ซื้ออะไรดี", r"ขายดีไหม", r"ควรซื้อ", r"ควรขาย", r"น่าซื้อ", r"ลงทุนอะไรดี", r"ตัวไหนดี", r"แนะนำ",
]
ADVICE = re.compile("|".join(ADVICE_PATTERNS), re.IGNORECASE)


def asks_for_advice(text: str) -> bool:
    """Plain-code check for "what should I buy" style questions, in English and Thai."""
    return ADVICE.search(text) is not None


def unbacked_numbers(reply: str, tool_results: list, user_text: str) -> list[float]:
    """Numbers in the reply that no tool result (or the user) gave us."""
    allowed = numbers_in(tool_results) | numbers_in(user_text)
    bad = []
    for m, (value, decimals) in zip(NUMBER.finditer(reply), numbers_in_text(reply)):
        x = abs(value)
        is_percent = PERCENT_AFTER.match(reply, m.end()) is not None
        if x <= ALWAYS_OK_MAX and decimals == 0 and not is_percent:  # "5%" is a claim, "5 steps" isn't
            continue
        if TIME_WORD_AFTER.match(reply, m.end()):
            continue
        half_step = 0.5 * 10 ** (-decimals) if decimals >= 0 else 0
        if not any(abs(x - abs(s)) <= max(TOLERANCE * abs(s), half_step) for s in allowed):
            bad.append(value)
    return bad
