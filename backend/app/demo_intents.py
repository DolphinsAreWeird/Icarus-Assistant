"""Focused demo requests use checked tools; advice remains with the model."""
import re
from uuid import uuid4

from app import knowledge, ui
from app.contracts import ChatReply, SourceRef
from app.tools import ToolContext, TOOLS

from app.insights import MONTH_NUMBERS as MONTHS

_BASE = r"gold|xau|ทอง(?:คำ)?|bitcoin|btc|บิ[ทต]คอยน์|ethereum|eth|อีเธอเรียม"
_ALIAS_TO_APP = {alias.lower(): app_id for app_id, ui_a in knowledge.app_ui()["assets"].items() if ui_a["data_id"]
                 for alias in knowledge.assets()[ui_a["data_id"]]["aliases"] + [app_id]}
# every alias of the stocks and funds too, longest first ("meta platforms" before "meta")
ALIASES = _BASE + "|" + "|".join(re.escape(k) for k in sorted(_ALIAS_TO_APP, key=len, reverse=True))


def asset(text):
    return ("XAU" if re.fullmatch(r"gold|xau|ทอง(?:คำ)?", text, re.I) else
            "BTC" if re.fullmatch(r"bitcoin|btc|บิ[ทต]คอยน์", text, re.I) else
            "ETH" if re.fullmatch(r"ethereum|eth|อีเธอเรียม", text, re.I) else
            _ALIAS_TO_APP.get(text.lower(), "ETH"))


def parse_intent(message):
    t = message.strip().rstrip("?.! ").lower()
    parsed = _parse(t)
    if parsed and parsed[0] == "show_asset" and not ui.in_app(parsed[1]["asset_id"]):
        return "show_chart", {"asset_ids": [parsed[1]["asset_id"]], "period": "1Y"}  # no page in the app: show its chart
    return parsed


def _parse(t):
    # Full-request matches intentionally reject advice, negation, conditions and compounds.
    m = re.fullmatch(rf"(?:put|buy|invest)\s+([0-9]+(?:,[0-9]{{3}})*(?:\.[0-9]{{1,2}})?)\s+(?:baht|thb)\s+(?:in|of)\s+({ALIASES})", t)
    if not m:
        m = re.fullmatch(rf"(?:ซื้อ|ลงทุน)\s*({ALIASES})\s*([0-9]+(?:,[0-9]{{3}})*(?:\.[0-9]{{1,2}})?)\s*บาท", t)
        if m:
            return "prepare_trade", {"asset_id": asset(m[1]), "side": "buy", "amount_thb": float(m[2].replace(",", ""))}
    elif m:
        return "prepare_trade", {"asset_id": asset(m[2]), "side": "buy", "amount_thb": float(m[1].replace(",", ""))}
    m = re.fullmatch(rf"(?:show me|open|take me to|ดู|เปิด)\s*({ALIASES})", t)
    if m:
        return "show_asset", {"asset_id": asset(m[1])}
    periods = {"one day": "1D", "one week": "1W", "one month": "1M", "one year": "1Y",
               "1d": "1D", "1w": "1W", "1m": "1M", "1y": "1Y", "1 ปี": "1Y", "1 เดือน": "1M", "1 สัปดาห์": "1W"}
    m = re.fullmatch(r"(?:switch to|show|ดูย้อนหลัง)\s+(.+)", t)
    if m and m[1] in periods:
        return "change_chart_period", {"period": periods[m[1]]}
    m = re.fullmatch(rf"(?:compare|เปรียบเทียบ)\s*({ALIASES})\s*(?:and|vs\.?|versus|with|to|against|กับ)\s*({ALIASES})(?:\s*(?:over|for|ย้อนหลัง)\s*(?:a |the past )?(year|month|week|1 ปี|1 เดือน))?", t)
    if m:
        return "show_chart", {"asset_ids": [asset(m[1]), asset(m[2])], "period": {"month": "1M", "week": "1W", "1 เดือน": "1M"}.get(m[3], "1Y")}
    m = re.fullmatch(rf"(?:how did|how has)\s+({ALIASES})\s+(?:do|perform)(?:\s+(?:over|this|the past)\s+(?:a )?(year|month|week))?", t)
    if m:
        return "show_chart", {"asset_ids": [asset(m[1])], "period": {"month": "1M", "week": "1W"}.get(m[2], "1Y")}
    m = re.fullmatch(rf"(?:walk me through buying|guide me through buying|สอนซื้อ)\s*({ALIASES})(?: step by step)?", t)
    if m:
        return "guide_me", {"asset_id": asset(m[1])}
    AMT = r"([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)"
    amount = lambda text: float(text.replace(",", ""))  # noqa: E731
    # price: "what's the price of bitcoin", "how much is gold", "ราคาทอง". Never a bare "what is gold" (that is a knowledge question).
    m = (re.fullmatch(rf"(?:what(?:'s| is) the (?:current |live )?price of|what(?:'s| is) (?:the )?price of|price of|how much is)\s+({ALIASES})(?:\s+(?:worth|now|today|right now|at the moment))*", t)
         or re.fullmatch(rf"what(?:'s| is)\s+({ALIASES})\s+(?:at|trading at|worth)(?:\s+(?:now|today|right now))?", t)
         or re.fullmatch(rf"ราคา\s*({ALIASES})(?:\s*(?:ตอนนี้|วันนี้|เท่าไหร่|เท่าไร))*", t))
    if m:
        return "tell_price", {"asset_id": asset(m[1])}
    # balance and portfolio X-ray
    if re.fullmatch(r"(?:how much (?:cash|money) do i have|how much do i have|what(?:'s| is) my (?:cash|balance|cash balance)|how much cash is in my account|ฉันมีเงินสดเท่าไหร่|ฉันมีเงินเท่าไหร่|ยอดเงินของฉัน|ยอดเงินคงเหลือ)(?: (?:left|now|right now))?", t) \
            or re.fullmatch(r"(?:how(?:'s| is) my money split|how is my money divided|what do i (?:own|hold)|what's in my portfolio||what are my holdings|how much is my portfolio worth|how much am i worth|portfolio summary|how much (?:did i pay|have i paid) in fees(?: this month)?|พอร์ตของฉัน|ฉันถืออะไรอยู่|เงินของฉันแบ่งยังไง)", t):
        return "get_balance", {}
    # risk in plain words: describes the past, never predicts
    m = (re.fullmatch(rf"how (?:risky|volatile) is\s+({ALIASES})", t) or re.fullmatch(rf"is\s+({ALIASES})\s+(?:risky|volatile)", t)
         or re.fullmatch(rf"how (?:much|far) (?:has|can|could|did)\s+({ALIASES})\s+(?:dropped?|fallen?|fall|lose|lost)(?: before)?", t)
         or re.fullmatch(rf"({ALIASES})\s*(?:เสี่ยง|ผันผวน)(?:ไหม|มั้ย|แค่ไหน)?", t))
    if m:
        return "get_risk", {"asset_id": asset(m[1])}
    # what-if (a past result): "what if I had put 1,000 baht in gold a year ago"
    WHEN = {"year": "1Y", "month": "1M", "3 months": "3M", "three months": "3M", "last year": "1Y", "1 ปี": "1Y", "1 เดือน": "1M"}
    m = re.fullmatch(rf"(?:what if|if) i (?:had )?(?:put|invested|bought)\s+{AMT}\s*(?:baht|thb)?\s+(?:in|into|of)\s+({ALIASES})\s+(?:(?:a|one|1)\s+(year|month)|(3 months|three months)|(last year))(?:\s+ago)?", t)
    if m:
        return "what_if", {"asset_id": asset(m[2]), "amount_thb": amount(m[1]), "period": WHEN[m[3] or m[4] or m[5]]}
    # goal math: "to save 50,000 baht by june", "i want to save 20,000 in 5 months"
    m = re.fullmatch(rf"(?:how much (?:do i need )?(?:to|should i) save (?:each|per|a|every) month (?:to|if i want to) )?(?:i (?:want|need) to |to |i'd like to )?(?:save|reach)\s+{AMT}\s*(?:baht|thb)?\s*(?:by\s+([a-z]+)|in\s+(\d{{1,2}})\s+months?)(?:\s*,?\s*how much (?:per|a|each|every) month)?", t)
    if m and (m[3] or m[2] in MONTHS):
        return "goal_math", ({"target_thb": amount(m[1]), "months": int(m[3])} if m[3] else {"target_thb": amount(m[1]), "by_month": MONTHS[m[2]]})
    simple = {
        "how do i buy": ("show_steps", {"topic": "buy"}), "ซื้อยังไง": ("show_steps", {"topic": "buy"}),
        "show me how to buy": ("show_steps", {"topic": "buy"}),
        "freeze my card": ("set_card_frozen", {"frozen": True}), "ล็อกบัตรของฉัน": ("set_card_frozen", {"frozen": True}),
        "unfreeze my card": ("set_card_frozen", {"frozen": False}), "ปลดล็อกบัตรของฉัน": ("set_card_frozen", {"frozen": False}),
        "hide my balance": ("set_balances_hidden", {"hidden": True}), "show my balance": ("set_balances_hidden", {"hidden": False}),
        "go back": ("go_back", {}), "cancel that": ("cancel_trade", {}), "cancel the preview": ("cancel_trade", {}),
        "ยกเลิก": ("cancel_trade", {}),
    }
    return simple.get(t)


def handle_intent(req, state, cache, user_id, lang):
    intent = parse_intent(req.text)
    if intent is None:
        return None
    name, args = intent
    ctx = ToolContext(state=state, cache=cache, user_id=user_id, lang=lang, screen=req.screen_context,
                      snapshot=None, card_frozen=bool((req.snapshot or {}).get("card_frozen")), ui_state=ui.state_from_snapshot(req.snapshot,
                      req.screen_context.screen_id if req.screen_context else None,
                      req.screen_context.selected_asset if req.screen_context else None))
    result = TOOLS[name](ctx, **args)
    data = result.get("data", result)
    source = result.get("source", {})
    ok = data.get("ok", True)
    en = {"prepare_trade": "Review this simulated purchase. Nothing is bought until you tap Confirm.",
          "show_chart": "Here is the saved price history. It does not predict future returns.",
          "show_steps": "Here are the steps. Use Show me to find each button.", "cancel_trade": "The preview is cancelled. Nothing was bought."}
    th = {"prepare_trade": "ตรวจสอบรายการซื้อจำลองนี้ ยังไม่มีการซื้อจนกว่าคุณจะแตะยืนยัน",
          "show_chart": "นี่คือกราฟราคาย้อนหลังที่บันทึกไว้ ไม่ใช่การคาดการณ์ผลตอบแทนในอนาคต",
          "show_steps": "นี่คือขั้นตอน แตะแสดงให้ดูเพื่อค้นหาปุ่มแต่ละปุ่ม", "cancel_trade": "ยกเลิกรายการแล้ว ยังไม่มีการซื้อ"}
    text = (en if lang == "en" else th).get(name, "Done. Check the screen." if lang == "en" else "เรียบร้อย ตรวจสอบบนหน้าจอได้เลย")
    own = data.get("reply") if isinstance(data.get("reply"), dict) else None
    if own and own.get(lang):
        text = own[lang]  # a question tool wrote its own sentence from its exact numbers, in both languages
    if ok and name == "cancel_trade" and "no open preview" in str(data.get("done", "")):
        text = "There was no open preview to cancel." if lang == "en" else "ไม่มีรายการที่ต้องยกเลิก"
    if not ok and data.get("reason") == "card_frozen":
        text = ({"en": 'Your card is frozen, so buying is blocked. Unfreeze it first, then try again.', "th": 'บัตรของคุณถูกล็อก จึงซื้อไม่ได้ ปลดล็อกก่อน แล้วลองใหม่อีกครั้งนะ'})[lang]
    elif not ok and not own:
        text = "I couldn't prepare that request. Check the amount, balance and supported asset." if lang == "en" else "ยังเตรียมรายการนี้ไม่ได้ โปรดตรวจสอบจำนวนเงิน ยอดคงเหลือ และสินทรัพย์ที่รองรับ"
    return ChatReply(text=text, speech=text, speak=req.input_mode == "voice", ui_actions=ui.finalize(ctx.ui_actions) if ok else [],
                     sources=[SourceRef(result_id=result.get("result_id", "demo_" + uuid4().hex), tool=name,
                                        provider=source.get("provider", "Icarus demo tools"),
                                        as_of=source.get("as_of"), freshness=source.get("freshness", "simulated"))],
                     status="ok" if ok else "data_unavailable", evidence=[result], emotion="curious",
                     suggestions=["Show me gold", "How do I buy?"], debug={"engine": "model", "route": "demo_intent", "tool": name})
