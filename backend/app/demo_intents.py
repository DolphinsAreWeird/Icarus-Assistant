"""Focused demo requests use checked tools; advice remains with the model."""
import re
from uuid import uuid4

from app import ui
from app.contracts import ChatReply, SourceRef
from app.tools import ToolContext, TOOLS

ALIASES = r"gold|xau|ทอง(?:คำ)?|bitcoin|btc|บิ[ทต]คอยน์|ethereum|eth|อีเธอเรียม"


def asset(text):
    return "XAU" if re.fullmatch(r"gold|xau|ทอง(?:คำ)?", text, re.I) else (
        "BTC" if re.fullmatch(r"bitcoin|btc|บิ[ทต]คอยน์", text, re.I) else "ETH")


def parse_intent(message):
    t = message.strip().rstrip("?.! ").lower()
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
    m = re.fullmatch(rf"(?:compare|เปรียบเทียบ)\s*({ALIASES})\s*(?:and|vs|กับ)\s*({ALIASES})(?:\s*(?:over|for|ย้อนหลัง)\s*(?:a |the past )?(year|month|week|1 ปี|1 เดือน))?", t)
    if m:
        return "show_chart", {"asset_ids": [asset(m[1]), asset(m[2])], "period": {"month": "1M", "week": "1W", "1 เดือน": "1M"}.get(m[3], "1Y")}
    m = re.fullmatch(rf"(?:how did|how has)\s+({ALIASES})\s+(?:do|perform)(?:\s+(?:over|this|the past)\s+(?:a )?(year|month|week))?", t)
    if m:
        return "show_chart", {"asset_ids": [asset(m[1])], "period": {"month": "1M", "week": "1W"}.get(m[2], "1Y")}
    m = re.fullmatch(rf"(?:walk me through buying|guide me through buying|สอนซื้อ)\s*({ALIASES})", t)
    if m:
        return "guide_me", {"asset_id": asset(m[1])}
    simple = {
        "how do i buy": ("show_steps", {"topic": "buy"}), "ซื้อยังไง": ("show_steps", {"topic": "buy"}),
        "freeze my card": ("set_card_frozen", {"frozen": True}), "ล็อกบัตรของฉัน": ("set_card_frozen", {"frozen": True}),
        "unfreeze my card": ("set_card_frozen", {"frozen": False}),
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
                      snapshot=None, ui_state=ui.state_from_snapshot(req.snapshot,
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
    if not ok:
        text = "I couldn't prepare that request. Check the amount, balance and supported asset." if lang == "en" else "ยังเตรียมรายการนี้ไม่ได้ โปรดตรวจสอบจำนวนเงิน ยอดคงเหลือ และสินทรัพย์ที่รองรับ"
    return ChatReply(text=text, speech=text, speak=True, ui_actions=ui.finalize(ctx.ui_actions) if ok else [],
                     sources=[SourceRef(result_id=result.get("result_id", "demo_" + uuid4().hex), tool=name,
                                        provider=source.get("provider", "Icarus demo tools"),
                                        as_of=source.get("as_of"), freshness=source.get("freshness", "simulated"))],
                     status="ok" if ok else "data_unavailable", evidence=[result], emotion="curious",
                     suggestions=["Show me gold", "How do I buy?"], debug={"engine": "model", "route": "demo_intent", "tool": name})
