"""One way to read a message: lower case, no punctuation, plain numbers, one name per asset.

The fast path's patterns and the prepared answers' matcher read text through normalize(), in
English and Thai, so "Could you put ฿1,000 in PAXG please?" and "put 1000 baht in gold" match the
same way. risky() spots what must go to the model however it's worded: negation, conditions,
several requests in one message.
"""
import re
from functools import cache

from app import knowledge

THAI = re.compile(r"[฀-๿]")
CANONICAL = {"gold": "gold", "btc": "bitcoin", "eth": "ethereum", "usdt": "usdt"}  # data id -> normalized name
# normalized name -> app id, for every asset with data (stocks and funds are named by their data id: "nvda")
NAMES = {CANONICAL.get(a["data_id"], a["data_id"]): app_id for app_id, a in knowledge.app_ui()["assets"].items() if a["data_id"]}

EN_REPLACE = [(re.compile(p), r) for p, r in [
    (r"\bwhat's\b", "what is"), (r"\bhow's\b", "how is"), (r"\bwhere's\b", "where is"), (r"\bwho's\b", "who is"),
    (r"\bit's\b", "it is"), (r"\bthat's\b", "that is"), (r"\bi'm\b", "i am"), (r"\bi'd\b", "i would"),
    (r"\bcan't\b", "cannot"), (r"\bwon't\b", "will not"), (r"\bdon't\b", "do not"), (r"\bdoesn't\b", "does not"),
    (r"\bdidn't\b", "did not"), (r"\bisn't\b", "is not"), (r"\baren't\b", "are not"), (r"\bshouldn't\b", "should not"),
    (r"\blet's\b", "let us"), (r"\bwanna\b", "want to"), (r"\bgonna\b", "going to"),
    (r"\bpls\b|\bplz\b", "please"), (r"\bu\b", "you"), (r"\bur\b", "your"),
    (r"(\w)'s\b", r"\1"),                                   # gold's price -> gold price
    (r"\bversus\b|\bvs\b", "vs"), (r"\bnever mind\b", "nevermind"), (r"\bstep-by-step\b", "step by step"),
    (r"\b(?:a|one) thousand\b", "1000"), (r"\btwo thousand\b", "2000"), (r"\bfive thousand\b", "5000"),
    (r"\bten thousand\b", "10000"), (r"\b(?:a|one) hundred\b", "100"), (r"\bfive hundred\b", "500"),
    (r"\b(\d+)k\b", r"\g<1>000"),
]]
TH_REPLACE = [("ล็อค", "ล็อก"), ("มั้ย", "ไหม"), ("มั๊ย", "ไหม"), ("ไม๊", "ไหม"), ("อย่างไร", "ยังไง"),
              ("ยังงัย", "ยังไง"), ("เป็นไง", "เป็นยังไง"), ("เท่าไร", "เท่าไหร่"), ("พอร์ตโฟลิโอ", "พอร์ต"),
              ("พอร์ทโฟลิโอ", "พอร์ต"), ("พอร์ท", "พอร์ต"), ("ไอคารัส", "icarus")]
TH_NUMBERS = {"หนึ่งหมื่น": "10000", "หมื่น": "10000", "ห้าพัน": "5000", "สองพัน": "2000", "หนึ่งพัน": "1000",
              "พัน": "1000", "ห้าร้อย": "500", "หนึ่งร้อย": "100", "ร้อย": "100"}
TH_NUMBER = re.compile("(" + "|".join(sorted(TH_NUMBERS, key=len, reverse=True)) + r")\s*(?=บาท)")

EN_LEAD = re.compile(r"^(?:(?:hey|hi|hello|ok|okay|so|um|uh|oh|well|icarus) )+|"
                     r"^(?:(?:please|can you|could you|would you|will you|can i|could i|may i|i want to|i would like to|"
                     r"i need to|i want|let us|let me|just|go ahead and) )+")
EN_TAIL = re.compile(r"(?: (?:please|for me|thanks|thank you|icarus))+$")
TH_LEAD = re.compile(r"^(?:icarus\s*)?(?:ช่วย|ฉันอยากจะ|ผมอยากจะ|ฉันอยาก|ผมอยาก|หนูอยาก|อยากจะ|อยาก|ขอ(?=ดู|ซื้อ|ขาย|ลงทุน|เปิด|รู้|ทราบ))+\s*")
TH_TAIL = re.compile(r"(?:\s*(?:ครับผม|ครับ|คับ|ค่ะ|คะ|จ้า|จ้ะ|จ๊ะ|นะคะ|นะครับ|นะ|น้า|หน่อย|ด้วย|ให้หน่อย|ให้ที|ได้ไหม|"
                     r"ของฉัน|ของผม|ของหนู|ของเรา|icarus))+$")
PUNCT = re.compile(r"\.(?!\d)|[?!,;:()\[\]{}\"“”‘’'…~*/\\|]")

# What the fast path and fuzzy matching never guess about: the model reads these.
RISKY_EN = re.compile(r"\b(?:not|no|never|cannot|without|neither|nor|except|instead|unless|if|suppose|supposing|"
                      r"assuming|assume|when|whenever|until|otherwise|then|also|plus|after|before|but|both|"
                      r"each|every|all of|maybe|might)\b")
RISKY_TH = re.compile(r"ไม่|อย่า|ห้าม|ยกเว้น|ถ้า|หาก|สมมติ|สมมุติ|เผื่อ|กรณี|จนกว่า|แล้ว|จากนั้น|แต่|อาจจะ")
MAX_CHARS = 120


@cache
def _aliases() -> tuple[re.Pattern, re.Pattern, dict]:
    """Every asset alias -> its normalized name: English as whole words, Thai anywhere."""
    names = {}
    for data_id, a in knowledge.assets().items():
        for alias in a["aliases"] + ([] if a["unit"] == "shares" else [a["unit"]]):  # "shares" names no one asset
            names[alias.lower()] = CANONICAL.get(data_id, data_id)
    for app_id, a in knowledge.app_ui()["assets"].items():
        if a["data_id"]:
            names[app_id.lower()] = names[a["name"].lower()] = CANONICAL.get(a["data_id"], a["data_id"])
    th = sorted((k for k in names if THAI.search(k)), key=len, reverse=True)
    en = sorted((k for k in names if not THAI.search(k)), key=len, reverse=True)
    return (re.compile(r"\b(?:" + "|".join(map(re.escape, en)) + r")\b"),
            re.compile("|".join(map(re.escape, th))), names)


def normalize(text: str) -> str:
    """Lower case, plain words and numbers, one name per asset, no politeness. Same in English and Thai."""
    t = text.lower().replace("’", "'").replace("‘", "'").replace("​", "")
    for pattern, repl in EN_REPLACE:
        t = pattern.sub(repl, t)
    for old, new in TH_REPLACE:
        t = t.replace(old, new)
    t = TH_NUMBER.sub(lambda m: TH_NUMBERS[m.group(1)] + " ", t)
    t = re.sub(r"(?<=\d),(?=\d{3}(?!\d))", "", t)                 # 1,000 -> 1000
    t = re.sub(r"฿\s*(\d+(?:\.\d+)?)", r"\1 baht ", t)             # ฿1000 -> 1000 baht
    t = re.sub(r"(\d)\s*(?:thb|bahts?|บาท|฿)(?![a-z])", r"\1 baht ", t)
    t = PUNCT.sub(" ", t)
    t = re.sub(r"(?<=[a-z])-(?=[a-z])", " ", t)                    # keep the minus in -1000
    en, th, names = _aliases()
    t = en.sub(lambda m: names[m.group(0)], t)
    t = th.sub(lambda m: f" {names[m.group(0)]} ", t)
    t = " ".join(t.split())
    for _ in range(3):  # politeness can stack: "hey icarus, could you please ..."
        stripped = EN_TAIL.sub("", t)
        stripped = EN_LEAD.sub("", stripped) if " " in stripped else stripped
        stripped = TH_TAIL.sub("", TH_LEAD.sub("", stripped)).strip()
        if not stripped or stripped == t:
            break
        t = stripped
    return t


def assets_in(norm: str) -> list[str]:
    """App ids of the assets with data that a normalized text names, in order."""
    return [NAMES[w] for w in norm.split() if w in NAMES]


def numbers_in(norm: str) -> list[str]:
    return re.findall(r"\d+(?:\.\d+)?", norm)


def risky(text: str, norm: str) -> bool:
    """True for anything the fast path must not guess about: negation, conditions, several requests
    or sentences, very long messages."""
    body = text.strip().rstrip("?!.。 ")
    return (len(norm) > MAX_CHARS or "\n" in body or re.search(r"[?!]|\.(?=\s)", body) is not None
            or RISKY_EN.search(norm) is not None or RISKY_TH.search(norm) is not None)
