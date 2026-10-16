"""A last check on what Icarus is about to say, whichever engine wrote it.

The prompts ask the model to follow the hard rules, but a prompt is not a guarantee. This is the guarantee for the two
worst failures, in English and Thai:
  - advice: telling the user to buy or sell, or promising a result ("it will rise", "guaranteed")
  - claiming a purchase is done (only the user's tap on Confirm purchase buys anything)
A reply that breaks either is replaced by a safe sentence. It deliberately matches narrow phrases, so normal replies such
as "Nothing is bought until you tap Confirm purchase" are never touched.
"""
import re

ADVICE = [
    r"\byou (should|must|ought to|need to|had better) (buy|sell|invest|hold|put|get|purchase)\b",
    r"\b(i|we) (recommend|suggest|advise)\b", r"\bi('d| would) (buy|sell|invest)\b",
    r"\b(good|great|best|right|perfect) (time|moment|opportunity) to (buy|sell|invest)\b",
    r"\b(is|are) (a |the )?(good|great|best|safe|smart) (buy|investment|bet|choice)\b",
    r"\b(better|best) (coin|asset|investment|choice|pick|option) (is|to buy)\b",
    r"\b(it|this|that)('s| is) the (best|top|safest|smartest) (coin|asset|pick|choice|investment|option)\b",
    r"\b(guaranteed|guarantee[sd]?|risk[- ]free|can't lose|cannot lose|sure (thing|profit)|certain(ly)? to)\b",
    r"\b(will|is going to|is sure to|is certain to) (almost )?(definitely |certainly |surely )?(rise|go up|increase|moon|double|grow)\b",
    r"\bbuy (it |this |that |them )?(now|today|immediately|asap)\b", r"\bdon'?t miss\b",
    r"ควร(ซื้อ|ขาย|ลงทุน|ถือ)", r"แนะนำ(ให้)?(ซื้อ|ขาย|ลงทุน)", r"รับรอง|การันตี|แน่นอนว่า(จะ)?(ขึ้น|ได้กำไร)|ไม่มีความเสี่ยง",
    r"ซื้อ(เลย|ตอนนี้|ด่วน)", r"จะ(ขึ้น|พุ่ง)แน่",
]
DONE = [
    r"\b(i|we)('ve| have)? (just )?(bought|purchased|placed|executed|completed|made) (the |your |a |an )?(buy|purchase|order|trade|transaction)?\b.{0,40}\b(for you|your|baht|gold|bitcoin|btc|eth)\b",
    r"\b(i|we)('ve| have)? (just )?(bought|purchased|sold)\b",
    r"\b(your|the) (purchase|order|trade|transaction|buy) (has been|have been|is|was|went)( successfully)? (done|complete|completed|placed|executed|confirmed|successful|through)\b",
    r"\b(has|have) been (completed|executed|placed|bought|purchased|confirmed)\b", r"\bconfirmed (your|the) (purchase|order)\b",
    r"ซื้อ.{0,15}(ให้แล้ว|ให้เรียบร้อย|เรียบร้อยแล้ว|สำเร็จแล้ว)", r"(ทำรายการ|สั่งซื้อ|ดำเนินการ)(ให้)?(แล้ว|เรียบร้อย|สำเร็จ)",
]
_ADVICE = re.compile("|".join(ADVICE), re.IGNORECASE)
_DONE = re.compile("|".join(DONE), re.IGNORECASE)

SAFE = {
    "advice": {"en": "I can't tell you what to buy or sell, or promise what a price will do. I can show its past ups and downs, or explain how it works.",
               "th": "ฉันบอกไม่ได้ว่าควรซื้อหรือขายอะไร และสัญญาไม่ได้ว่าราคาจะเป็นอย่างไร แต่ช่วยดูข้อมูลย้อนหลังหรืออธิบายให้ได้"},
    "done": {"en": "Nothing is bought until you tap Confirm purchase yourself. I can set it up and show you the fee and total first.",
             "th": "จะยังไม่มีการซื้อจนกว่าคุณจะแตะ Confirm purchase เอง ฉันตั้งค่าและแสดงค่าธรรมเนียมกับยอดรวมให้ดูก่อนได้"},
}


def violation(text: str) -> str | None:
    """'advice', 'done' or None."""
    if _DONE.search(text):
        return "done"
    if _ADVICE.search(text):
        return "advice"
    return None


def guard_text(text: str, lang: str = "en") -> tuple[str, str | None]:
    """The text to send, and which rule it broke (None when it was fine)."""
    found = violation(text)
    if found is None:
        return text, None
    return SAFE[found]["th" if lang == "th" else "en"], found
