"""Bind model-selected monetary arguments to explicit user input, never model prose."""
import re
from icarus_core import money

LABELS = {"usdt":"USDT", "usd":"USD", "eur":"EUR", "thb":"THB", "baht":"THB",
          "บาท":"THB", "dollar":"USD", "dollars":"USD", "ดอลลาร์":"USD", "$":"USD"}
AMOUNT = r"[+-]?(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:\.[0-9]+)?"
UNIT = r"(?:USDT|USD|EUR|THB|baht|dollars?|บาท|ดอลลาร์|\$)"
PATTERN = re.compile(r"(?<![a-zA-Z0-9.,+-])(?:(?P<value>"+AMOUNT+r")\s*(?P<unit>"+UNIT+
                     r")(?![a-z])|(?P<prefix>"+UNIT+r")\s*(?P<following>"+AMOUNT+r")(?![\d.,]))", re.I)


def monetary_mentions(text):
    mentions = []
    for match in PATTERN.finditer(text):
        prefix = text[max(0, match.start()-60):match.start()].lower()
        roles = [(found.start(), role) for role, pattern in (
            ("target_thb", r"\b(?:target|goal|want|need)\b[^;,.]{0,35}$|(?:เป้าหมาย|ต้องการ)[^;,.]{0,35}$"),
            ("current_thb", r"\b(?:current|have|saved|already)\b[^;,.]{0,35}$|(?:มีแล้ว|มีอยู่)[^;,.]{0,35}$"))
                 for found in re.finditer(pattern, prefix)]
        mentions.append({"value":money((match["value"] or match["following"]).replace(",", "")),
                         "currency":LABELS[(match["unit"] or match["prefix"]).lower()],
                         "role":max(roles)[1] if roles else None})
    return mentions


def mentioned_assets(text):
    return {asset for asset, pattern in {
        "btc":r"\b(?:btc|bitcoin)\b|บิตคอยน์", "eth":r"\b(?:eth|ethereum)\b|อีเธอเรียม",
        "gold":r"\b(?:gold|paxg)\b|ทอง"}.items() if re.search(pattern, text, re.I)}


def natural_calculation(message):
    """Conservative complete-input routes; mixed advice/unknown values stay with Qwen."""
    text = message.lower()
    if re.search(r"\b(?:should|recommend|suit|allocation|compare|current|today's price|risks?|wallets?|custody|staking|tax|gas|network|withdrawal)\b|ควร|เหมาะ|แนะนำ|สัดส่วน|เปรียบเทียบ|ราคาปัจจุบัน|เสี่ยง|กระเป๋า|รับฝาก|ภาษี|แก๊ส|เครือข่าย|ถอน", text):
        return None
    whatif = bool(re.search(r"what[ -]if|สมมติซื้อ", text))
    savings = bool(re.search(r"\bcalculat\w*\b.*\b(?:savings|contributions?)\b|คำนวณ.*ออม", text))
    fee = bool(re.search(r"\b(?:mock|simulated)\b.*\b(?:platform )?fee\b|\bplatform fee\b.*\b(?:mock|simulated)\b|ค่าธรรมเนียม.*จำลอง", text))
    if not any((whatif, savings, fee)):
        return None
    if fee and not whatif and not savings:
        clauses = re.split(r"\band\b|และ|พร้อมกับ|แล้ว", text)
        if any(not re.search(r"\b(?:purchase amount|remaining|left|fee)\b|จำนวนที่เหลือ|เหลือซื้อ|ค่าธรรมเนียม", clause)
               for clause in clauses[1:]):
            return None
    mentions = monetary_mentions(message)
    dates = re.findall(r"\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b", message)
    if whatif:
        assets = mentioned_assets(message)
        if re.search(r"\bfees?\b|ค่าธรรมเนียม", text) and not re.search(r"\b(?:no|without|excluding) fees?\b|ไม่รวมค่าธรรมเนียม", text):
            return None
        if len(mentions) == 1 and mentions[0]["currency"] == "USDT" and len(dates) == 2 and len(assets) == 1:
            return "what_if", {"asset_id":next(iter(assets)), "amount_usdt":str(mentions[0]["value"]),
                               "start_date":dates[0], "end_date":dates[1]}
    elif savings:
        roles = {m["role"]:m for m in mentions if m["currency"] == "THB" and m["role"]}
        if len(mentions) == 2 and set(roles) == {"target_thb", "current_thb"} and len(dates) == 1:
            return "goal_math", {**{key:str(value["value"]) for key, value in roles.items()}, "target_date":dates[0]}
    elif fee and len(mentions) == 1 and mentions[0]["currency"] == "THB" and not re.search(
            r"\b(?:goal|gas|network|withdrawal|invest)\b|เป้าหมาย|แก๊ส|เครือข่าย|ถอน|ลงทุน", text):
        return "calculate_fee", {"budget_thb":str(mentions[0]["value"])}
    return None


def amount_context(message, memory):
    current = monetary_mentions(message)
    if current:
        return current
    # A new bare amount is not automatically in the old currency. ISO dates
    # alone are not new monetary input and may accompany an explicit follow-up.
    without_dates = re.sub(r"\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b", "", message)
    if re.search(r"[0-9]", without_dates):
        raise ValueError("NEW_AMOUNT_REQUIRES_EXPLICIT_CURRENCY")
    for turn in reversed((memory or [])[-4:]):
        prior = monetary_mentions(turn.get("user", ""))
        if prior:
            return prior
    return []


def validate_monetary_arguments(name, args, message, memory, profile=None):
    fields = {"calculate_fee":{"budget_thb":"THB"}, "what_if":{"amount_usdt":"USDT"},
              "goal_math":{"target_thb":"THB", "current_thb":"THB"}}
    if name not in fields:
        return
    if not isinstance(args, dict):
        raise ValueError("INVALID_TOOL_ARGUMENTS")
    mentions = amount_context(message, memory)
    if not mentions and name == "calculate_fee" and profile and profile.get("budget_thb") is not None and re.search(
            r"\b(?:my|saved|stated) budget\b|งบที่(?:บอก|ระบุ)|งบลงทุน", message, re.I):
        mentions = [{"value":money(profile["budget_thb"]), "currency":"THB"}]
    for field, currency in fields[name].items():
        if field not in args or not any(m["currency"] == currency and m["value"] == money(args[field]) and
                                       (name != "goal_math" or m.get("role") == field) for m in mentions):
            raise ValueError("TOOL_AMOUNT_NOT_SUPPORTED_BY_USER_INPUT")
    if name in ("goal_math", "what_if"):
        date_fields = ("target_date",) if name == "goal_math" else ("start_date", "end_date")
        dates = set(re.findall(r"\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b", message))
        if not dates:
            for turn in reversed((memory or [])[-4:]):
                dates = set(re.findall(r"\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b", turn.get("user", "")))
                if dates:
                    break
        if any(args.get(field) not in dates for field in date_fields):
            raise ValueError("TOOL_DATE_NOT_SUPPORTED_BY_USER_INPUT")
    if name == "what_if":
        known = mentioned_assets(message)
        if not known:
            for turn in reversed((memory or [])[-4:]):
                known = mentioned_assets(turn.get("user", ""))
                if known:
                    break
        if args.get("asset_id") not in known:
            raise ValueError("TOOL_ASSET_NOT_SUPPORTED_BY_USER_INPUT")
