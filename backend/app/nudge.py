"""Proactive help: what Icarus says when a user has been stuck on a screen for a while.

The app measures the idle time (about 15 s) and asks. This module only decides WHAT to say, and it is
rule-based on purpose: no model call, so it is instant, works offline, and cannot invent a number or give advice.
Rules look at the screen's state; the wording is a reviewed English and Thai template; the only numbers are the
buy minimum and the user's cash, both from data.

Hard rules kept: no advice (a nudge never tells the user to buy anything), numbers only from data, and no action
without the user's tap. A highlight is visual only. A `suggestion` is a chat message the user taps to send.

The app has no KYC / onboarding screen, so there is no ID nudge. When one exists, add a rule keyed on its screen.
"""
import math

from app import display, knowledge, ui

# reason -> {lang: text with {placeholders}}. Thai needs a Thai speaker's check.
TEXT = {
    "card_frozen": {
        "en": "Your card is frozen, so buying is blocked. Unfreeze it first.",
        "th": "บัตรของคุณถูกล็อก จึงซื้อไม่ได้ ปลดล็อกก่อนนะ"},
    "wrong_wallet": {
        "en": "Buying works from the THB Wallet. Switch the wallet on this screen.",
        "th": "ซื้อได้จากกระเป๋า THB เท่านั้น สลับกระเป๋าบนหน้านี้ได้เลย"},
    "below_minimum": {
        "en": "The minimum is {minimum}. Try a bigger amount.",
        "th": "ขั้นต่ำคือ {minimum} ลองใส่จำนวนที่มากขึ้นนะ"},
    "not_enough_cash": {
        "en": "You have {cash} available. Try a smaller amount.",
        "th": "คุณมี {cash} ที่ใช้ได้ ลองใส่จำนวนที่น้อยลงนะ"},
    "empty_amount": {
        "en": "Type how many baht you want to spend. The minimum is {minimum}.",
        "th": "พิมพ์จำนวนเงินบาทที่ต้องการใช้ ขั้นต่ำ {minimum}"},
    "ready_to_review": {
        "en": "Looks good. Tap Review purchase to check the fee and total.",
        "th": "ดูดีแล้ว แตะ Review purchase เพื่อดูค่าธรรมเนียมและยอดรวม"},
    "review_waiting": {
        "en": "Check the amount, fee and total. Nothing is bought until you tap Confirm purchase.",
        "th": "ตรวจสอบจำนวน ค่าธรรมเนียม และยอดรวม จะยังไม่ซื้อจนกว่าคุณจะแตะ Confirm purchase"},
    "payments_dead_end": {
        "en": "Swap and Send aren't part of this demo. To get into an asset, open Invest and tap Buy.",
        "th": "สวอปและส่งเงินยังไม่เปิดในเดโมนี้ ถ้าอยากเริ่มกับสินทรัพย์ ไปที่ Invest แล้วแตะ Buy"},
    "card_screen": {
        "en": "Want to pause payments? Tap Freeze. You can unfreeze any time.",
        "th": "อยากหยุดการจ่ายชั่วคราวไหม แตะ Freeze ปลดล็อกได้ทุกเมื่อ"},
}

# Chat messages the chips send. They are phrases Icarus already understands (demo_intents.py).
CHIPS = {
    "unfreeze": {"en": "Unfreeze my card", "th": "ปลดล็อกบัตรของฉัน"},
    "how_to_buy": {"en": "How do I buy?", "th": "ซื้อยังไง"},
    "freeze": {"en": "Freeze my card", "th": "ล็อกบัตรของฉัน"},
}

# reason -> (element to highlight on that screen, chip)
EXTRAS = {
    "card_frozen": (None, "unfreeze"),
    "wrong_wallet": (None, None),
    "below_minimum": ("buy.amount_input", None),
    "not_enough_cash": ("buy.amount_input", None),
    "empty_amount": ("buy.amount_input", "how_to_buy"),
    "ready_to_review": ("buy.review_button", None),
    "review_waiting": ("buy.confirm_button", None),
    "payments_dead_end": (None, "how_to_buy"),
    "card_screen": (None, "freeze"),
}


def _reason(snapshot: dict, state: ui.UIState, cash_thb: float, minimum: float) -> str | None:
    """The first rule that matches this screen's state, or None when there is nothing useful to say."""
    if state.screen == "payments":
        return "payments_dead_end"
    if state.screen == "card":
        return "card_screen"
    if state.screen not in ("buy", "buy_review"):
        return None
    if "complete" in str(snapshot.get("label", "")).lower():
        return None  # the purchase is done
    if snapshot.get("card_frozen"):
        return "card_frozen"
    if state.screen == "buy_review":
        return "review_waiting"
    buy = snapshot.get("buy")
    buy = buy if isinstance(buy, dict) else {}
    if buy.get("wallet") not in (None, "thb"):
        return "wrong_wallet"
    try:
        typed = float(buy.get("total_thb") or buy.get("amount_thb") or 0)
    except (TypeError, ValueError):
        return None  # not a number: say nothing rather than guess
    if not math.isfinite(typed):
        return None
    if typed <= 0:
        return "empty_amount"
    if typed < minimum:
        return "below_minimum"
    if typed > cash_thb:
        return "not_enough_cash"
    return "ready_to_review"


def decide(snapshot: dict | None, cash_thb: float, lang: str = "en") -> dict | None:
    """The nudge for this screen, or None. Returns {reason, text, highlight, suggestions}."""
    snapshot = snapshot or {}
    lang = "th" if lang == "th" else "en"
    state = ui.state_from_snapshot(snapshot)
    minimum = knowledge.app_ui()["min_buy_thb"]
    reason = _reason(snapshot, state, cash_thb, minimum)
    if reason is None:
        return None
    element, chip = EXTRAS[reason]
    # Only point at something that is on the screen the user is looking at right now.
    if element is not None and knowledge.app_ui()["elements"].get(element, {}).get("screen") != state.screen:
        element = None
    if element is not None:
        ui.validate({"type": "highlight", "element_id": element})
    text = TEXT[reason][lang].format(minimum=display.exact_baht(minimum, lang), cash=display.exact_baht(cash_thb, lang))
    return {"reason": reason, "text": text, "highlight": element,
            "suggestions": [CHIPS[chip][lang]] if chip else []}
