"""Plain-code checks around the model: before (language, assets mentioned) and
after (every number in the reply must come from a tool result or the user)."""
import re

THAI = re.compile(r"[฀-๿]")
NUMBER = re.compile(r"(?<![A-Za-z0-9_.])-?\d[\d,]*(?:\.\d+)?(?:\s*(million\b|ล้าน|billion\b|k\b))?",
                    re.IGNORECASE)
MULTIPLIER = {"million": 1e6, "ล้าน": 1e6, "billion": 1e9, "k": 1e3}
ALWAYS_OK_MAX = 10       # counting words like "2 steps" or "3 sentences"
TOLERANCE = 0.03         # "about 142,700" for 142,712.36 is fine
WORD_VALUES = dict(zip(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(),
    range(20))) | {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
                  "seventy": 70, "eighty": 80, "ninety": 90, "a": 1, "an": 1, "half": 0.5}
WORD_SCALES = {"hundred": 100, "thousand": 1000, "million": 1e6, "billion": 1e9}
WORD_TOKEN = "|".join([*WORD_VALUES, *WORD_SCALES, "and", "point"])
# Only financial word amounts are numbers here: ordinary "one step" / "a card"
# prose stays untouched. Digits are checked independently, including unspaced Thai.
WORD_NUMBER = re.compile(
    rf"(?<![A-Za-z])(?:{WORD_TOKEN})(?:[ -]+(?:{WORD_TOKEN}))*(?![A-Za-z])"
    r"(?=\s*(?:baht\b|THB\b|USD\b|USDT\b|dollars?\b|บาท|%|percent\b|per cent\b|เปอร์เซ็นต์))",
    re.IGNORECASE)
THAI_WORD_VALUES = dict(zip("ศูนย์ หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด เก้า".split(), range(10))) | {"เอ็ด": 1, "ยี่": 2}
THAI_WORD_SCALES = {"สิบ": 10, "ร้อย": 100, "พัน": 1000, "หมื่น": 10000, "แสน": 100000, "ล้าน": 1000000}
THAI_WORD_TOKEN = "|".join([*THAI_WORD_VALUES, *THAI_WORD_SCALES, "จุด"])
THAI_WORD_NUMBER = re.compile(
    rf"(?:{THAI_WORD_TOKEN})+(?=\s*(?:บาท|ดอลลาร์|เปอร์เซ็นต์|%))")
THAI_NUMBER_TOKEN = re.compile(THAI_WORD_TOKEN)


def _thai_word_number(raw: str) -> float:
    total, section, digit, decimal_place = 0.0, 0.0, None, None
    for word in THAI_NUMBER_TOKEN.findall(raw):
        if word == "จุด":
            section += digit or 0
            digit, decimal_place = None, 0.1
        elif word in THAI_WORD_VALUES:
            value = THAI_WORD_VALUES[word]
            if decimal_place is None:
                digit = value
            else:
                section += value * decimal_place
                decimal_place /= 10
        elif word == "ล้าน":
            total = (total + section + (digit or 0)) * 1e6
            section, digit, decimal_place = 0.0, None, None
        else:
            section += (1 if digit is None else digit) * THAI_WORD_SCALES[word]
            digit = None
    return total + section + (digit or 0)


def _word_number(raw: str) -> float:
    total, current, decimal_place = 0.0, 0.0, None
    for word in re.split(r"[ -]+", raw.lower()):
        if word == "and":
            continue
        if word == "point":
            decimal_place = 0.1
        elif word in WORD_VALUES:
            value = WORD_VALUES[word]
            if decimal_place is None:
                current += value
            else:
                current += value * decimal_place
                decimal_place /= 10
        elif word == "hundred":
            current = (current or 1) * 100
        else:
            total += (current or 1) * WORD_SCALES[word]
            current, decimal_place = 0.0, None
    return total + current


SENTENCE_END = re.compile(r"(?<=[.!?])\s+")
CARD_TEXT_MAX = 160  # Thai has no full stops, so cap the length instead
REPLY_TEXT_MAX = 300


def _cap(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text.rfind(" ", 0, limit)
    return text[: cut if cut > 0 else limit].rstrip(" ,")


def first_sentence(text: str) -> str:
    """The first sentence, for replies that come with a chart or steps card: the card has the rest,
    and the voice shouldn't read the steps out."""
    return _cap(SENTENCE_END.split(text.strip(), maxsplit=1)[0], CARD_TEXT_MAX)


def first_sentences(text: str, n: int = 2) -> str:
    """At most n sentences: answers stay short even when the model rambles."""
    parts = SENTENCE_END.split(text.strip(), maxsplit=n)
    return _cap(" ".join(parts[:n]) if len(parts) > n else text.strip(), REPLY_TEXT_MAX)


# What some models say before the answer. Dropped when an answer follows.
FILLER = re.compile(r"^(?:(?:hi|hello|hey|welcome)\b|(?:sure|of course|certainly|absolutely|great|okay|ok|no worries|"
                    r"no problem)\b\W*$|i(?:'m|’m| am) (?:here to help|glad you asked|happy to help)|"
                    r"(?:great|good) question|let me (?:explain|share|help|show)|i (?:can|will) (?:share|explain) what|"
                    r"here(?:'s| is) what|i see (?:you|that))", re.IGNORECASE)
BRIEF_WORDS = 40      # one or two short sentences and a short question
THAI_TEXT_MAX = 180   # Thai has no full stops: cut by length, at a space
THAI_QUESTION = re.compile(r"(?:\?|ไหม|หรือเปล่า|หรือยัง)$")
THAI_QUESTION_END = re.compile(r"(?:\?|ไหม|หรือเปล่า|หรือยัง)(?= |$)")
DANGLING = re.compile(r"(?:\d|ประมาณ|about|:)$")  # never end a cut on "ประมาณ 2.8" without its unit, or on "...:"


def _cut_thai(text: str, limit: int) -> str:
    """At most limit characters, cut at a space, and not after a number or a word that needs one."""
    cut = text if len(text) <= limit else text[:limit].rsplit(" ", 1)[0]
    while " " in cut and DANGLING.search(cut):
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(" ,:")


# Names that keep their capital in the middle of a sentence ("gold" doesn't: the app says "gold" mid-sentence).
NAMES = {"bitcoin", "ethereum", "tether", "paxos", "pax", "u-topia", "utopia", "icarus", "apple", "tesla", "home",
         "invest", "portfolio", "wallets", "payments", "card", "buy", "confirm", "review", "swap", "send", "receive",
         "freeze", "top", "thai", "english"}


def _join(first: str, second: str) -> str:
    """Two sentences as one: "You're on Home. It shows..." -> "You're on Home; it shows..."."""
    word = re.sub(r"[^\w'’-].*", "", second.split(" ", 1)[0])
    if not (word.isupper() or word in ("I",) or word.startswith(("I'", "I’")) or word.lower() in NAMES):
        second = second[:1].lower() + second[1:]
    return f"{first[:-1]}; {second}"


def brief(text: str, lang: str = "en") -> str:
    """The answer first, then the closing question if there is one ("Want me to explain the chart?"): two
    sentences at most (the app speaks them), about 40 words. A model's filler before the answer ("I'm here
    to help!") goes; a fact in a second sentence is joined to the first rather than lost, and anything
    after that goes, but the question. Thai, which has no full stops, is cut by length instead, keeping
    its closing question."""
    text = text.strip()
    if lang == "th" and len(text) > THAI_TEXT_MAX:
        asks = [m.end() for m in THAI_QUESTION_END.finditer(text, 0, THAI_TEXT_MAX)]
        if asks and asks[-1] >= THAI_TEXT_MAX // 3:  # end on the last whole question that fits
            return text[: asks[-1]]
        tail = text.rsplit(" ", 1)[-1] if " " in text else ""
        if THAI_QUESTION.search(tail) and 8 <= len(tail) < THAI_TEXT_MAX // 3:  # else keep a short closing one
            return f"{_cut_thai(text[: -len(tail)].rstrip(), THAI_TEXT_MAX - len(tail) - 1)} {tail}"
        return _cut_thai(text, THAI_TEXT_MAX)
    parts = [p for p in SENTENCE_END.split(text) if p]
    while len(parts) > 1 and FILLER.search(parts[0]):
        parts.pop(0)
    if len(parts) > 2:
        ask = parts[-1] if parts[-1].endswith("?") else None
        if not ask:
            parts = parts[:2]
        elif parts[0].endswith(".") and len(f"{parts[0]} {parts[1]} {ask}".split()) <= BRIEF_WORDS:
            parts = [_join(parts[0], parts[1]), ask]
        else:
            parts = [parts[0], ask]
    return _cap(" ".join(parts), REPLY_TEXT_MAX)


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


def _number_spans(text: str) -> list[tuple[int, int, float, int]]:
    """Digit and financial word amounts, with offsets shared by extraction and checking."""
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
        out.append((m.start(), m.end(), value, decimals))
    for m in WORD_NUMBER.finditer(text):
        if any(start < m.end() and m.start() < end for start, end, _, _ in out):
            continue  # "2.7 million" already belongs to the digit amount
        value = _word_number(m.group())
        out.append((m.start(), m.end(), value, -6 if value >= 1000 else 2))
    for m in THAI_WORD_NUMBER.finditer(text):
        if any(start < m.end() and m.start() < end for start, end, _, _ in out):
            continue
        value = _thai_word_number(m.group())
        out.append((m.start(), m.end(), value, -6 if value >= 1000 else 2))
    return sorted(out)


def numbers_in_text(text: str) -> list[tuple[float, int]]:
    """Numbers with their decimal places, including spelled financial amounts."""
    return [(value, decimals) for _, _, value, decimals in _number_spans(text)]


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
CURRENCY_AFTER = re.compile(r"\s*(?:baht\b|THB\b|USD\b|USDT\b|dollars?\b|บาท|฿|\$)", re.IGNORECASE)
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


# A question about safety or trust, and a reply that talks about protection, insurance, licences or
# regulation: the model may have made a claim we can't back, so the approved line is said instead.
SAFETY_TOPIC = re.compile(r"\b(?:safe\w*|secur\w*|trust\w*|protect\w*|insur\w*|guarantee\w*|regulat\w*|licen[cs]\w*|"
                          r"legit\w*|scam\w*|hack\w*|fraud\w*)\b|ปลอดภัย|ไว้ใจ|เชื่อถือ|คุ้มครอง|ประกัน|โกง|หลอก|แฮก",
                          re.IGNORECASE)
SECURITY_CLAIM = re.compile(r"\b(?:insur\w*|guarantee\w*|regulat\w*|licen[cs]\w*|protect\w*|secur\w*|encrypt\w*)\b|"
                            r"คุ้มครอง|ประกัน|กำกับ|ใบอนุญาต|เข้ารหัส|ความปลอดภัย|มาตรการ", re.IGNORECASE)


def security_claim(question: str, reply: str) -> bool:
    return SAFETY_TOPIC.search(question) is not None and SECURITY_CLAIM.search(reply) is not None


# The app's Thai leaves out gender particles (voice/src/config/strings.ts); some models add them anyway.
THAI_PARTICLE = re.compile(r"\s*(?:ครับผม|ครับ|ค่ะ|คะ)(?=[\s?!.,:;]|$)")
LIST_BREAK = re.compile(r"\s*\n+\s*(?:[-*•]\s+|\d+[.)]\s+)?")


def plain_reply(text: str, lang: str) -> str:
    """One line of plain text: no list markers or bold, and in Thai no ครับ or ค่ะ."""
    text = LIST_BREAK.sub(" ", text.replace("**", "")).strip()
    return THAI_PARTICLE.sub("", text) if lang == "th" else text


def unbacked_numbers(reply: str, tool_results: list, user_text: str) -> list[float]:
    """Numbers in the reply that no tool result (or the user) gave us."""
    allowed = numbers_in(tool_results) | numbers_in(user_text)
    bad = []
    for start, end, value, decimals in _number_spans(reply):
        x = abs(value)
        is_percent = PERCENT_AFTER.match(reply, end) is not None
        is_money = (CURRENCY_AFTER.match(reply, end) is not None
                    or re.search(r"(?:฿|\$|\bTHB|\bUSD|\bUSDT)\s*$", reply[:start], re.IGNORECASE))
        if x <= ALWAYS_OK_MAX and decimals == 0 and not (is_percent or is_money):
            continue
        if TIME_WORD_AFTER.match(reply, end):
            continue
        half_step = 0.5 * 10 ** (-decimals) if decimals >= 0 else 0
        if not any(abs(x - abs(s)) <= max(TOLERANCE * abs(s), half_step) for s in allowed):
            bad.append(value)
    return bad
