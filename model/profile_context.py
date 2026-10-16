"""Conservative explicit profile intake. No inferred financial circumstances."""
import re

from icarus_core import money

FIELDS = {"goal","horizon_months","essential_money","loss_capacity","risk_preference","experience","budget_thb"}
LEVELS = {"low":"low","moderate":"moderate","high":"high","ต่ำ":"low","ปานกลาง":"moderate","สูง":"high"}


def validate_updates(updates):
    if not isinstance(updates,dict) or set(updates)-FIELDS:
        raise ValueError("UNKNOWN_PROFILE_FIELD")
    checked = {}
    for field,value in updates.items():
        if value is None:
            checked[field] = None
        elif field == "goal":
            if not isinstance(value,str) or not value.strip() or len(value)>200:
                raise ValueError("INVALID_GOAL")
            checked[field] = value.strip()
        elif field == "horizon_months":
            if type(value) is not int or not 0 <= value <= 1200:
                raise ValueError("INVALID_HORIZON")
            checked[field] = value
        elif field == "essential_money":
            if type(value) is not bool:
                raise ValueError("ESSENTIAL_MONEY_REQUIRES_BOOLEAN")
            checked[field] = value
        elif field in ("loss_capacity","risk_preference"):
            if not isinstance(value,str) or value not in LEVELS:
                raise ValueError("INVALID_RISK_LEVEL")
            checked[field] = LEVELS[value]
        elif field == "experience":
            if value not in ("beginner","some","experienced"):
                raise ValueError("INVALID_EXPERIENCE")
            checked[field] = value
        elif field == "budget_thb":
            checked[field] = str(money(value))
    return checked


def parse_set_command(message):
    match = re.fullmatch(r"/set\s+(\w+)\s+(.+)",message.strip(),re.DOTALL)
    if not match:
        raise ValueError("USE_SET_FIELD_VALUE")
    field,value = match.groups()
    if field not in FIELDS:
        raise ValueError("UNKNOWN_PROFILE_FIELD")
    if value.lower() in ("null","unknown"):
        value = None
    elif field == "horizon_months":
        if not re.fullmatch(r"\d+",value):
            raise ValueError("INVALID_HORIZON")
        value = int(value)
    elif field == "essential_money":
        if value.lower() not in ("true","false"):
            raise ValueError("ESSENTIAL_MONEY_REQUIRES_BOOLEAN")
        value = value.lower()=="true"
    return validate_updates({field:value})


def extract_explicit_updates(message):
    """Recognize only whole factual clauses. Unknown/ambiguous wording stays unknown."""
    if (re.search(r"\b(?:hypothetical|suppose|imagine|example|fictional|pretend|translate|quote|quoted|quotation|if)\b|สมมติ|ตัวอย่าง|ถ้า|แปลประโยค",message,re.IGNORECASE)
        or any(character in message for character in ('"','“','”','`'))
        or (message.strip().startswith("'") and message.strip().endswith("'"))):
        return {"updates":{},"source_quotes":{},"unrecognized":[message]}
    updates,quotes,unrecognized = {},{},[]
    clauses = [part.strip() for part in re.split(r"[;\n]+|(?<=[.!?])\s+",message) if part.strip()]
    for original in clauses:
        clause = re.sub(r"^(?:actually,?\s*|correction:\s*|แก้ไข[:：]?\s*)","",original,flags=re.IGNORECASE).rstrip(".!?")
        found = None
        goal = re.fullmatch(r"(?:my goal is\s+|เป้าหมาย(?:ของฉัน)?คือ\s*)(.+)",clause,re.IGNORECASE)
        if original.endswith("?") or (goal and re.search(r"\b(?:should|compare|explain|calculate|tell me|what|how|why|can you)\b|ไหม|หรือเปล่า|เปรียบเทียบ|อธิบาย|คำนวณ|ช่วย|ควร",goal[1],re.IGNORECASE)):
            unrecognized.append(original)
            continue
        horizon = re.fullmatch(r"(?:my (?:investment )?horizon is|i can leave this money invested for)\s+(\d+)\s+(months?|years?)",clause,re.IGNORECASE)
        horizon_th = re.fullmatch(r"(?:ระยะเวลาลงทุน(?:คือ)?|ฉันใช้เงินนี้ในอีก|ฉันลงทุนได้)\s*(\d+)\s*(เดือน|ปี)",clause)
        risk = re.fullmatch(r"my (loss capacity|risk preference) is\s+(low|moderate|high)",clause,re.IGNORECASE)
        risk_th = re.fullmatch(r"(ความสามารถรับผลขาดทุน|ความเต็มใจรับความเสี่ยง)(?:คือ)?\s*(ต่ำ|ปานกลาง|สูง)",clause)
        budget = re.fullmatch(r"(?:my budget is\s+)([0-9]+(?:\.[0-9]+)?)\s*(?:THB|baht)",clause,re.IGNORECASE)
        budget_th = re.fullmatch(r"งบลงทุน(?:คือ)?\s*([0-9]+(?:\.[0-9]+)?)\s*บาท",clause)
        if goal:
            found = ("goal",goal[1])
        elif horizon or horizon_th:
            match = horizon or horizon_th
            amount = int(match[1]) * (12 if match[2].lower() in ("year","years","ปี") else 1)
            found = ("horizon_months",amount)
        elif risk or risk_th:
            match = risk or risk_th
            field = "loss_capacity" if match[1].lower() in ("loss capacity","ความสามารถรับผลขาดทุน") else "risk_preference"
            found = (field,match[2].lower())
        elif clause.lower() in ("this money is essential","เงินนี้เป็นเงินจำเป็น","เงินนี้ต้องใช้จ่ายจำเป็น"):
            found = ("essential_money",True)
        elif clause.lower() in ("this money is not essential","this money is not needed for essentials","เงินนี้ไม่ใช่เงินจำเป็น","เงินนี้เป็นเงินส่วนเกิน"):
            found = ("essential_money",False)
        elif budget or budget_th:
            found = ("budget_thb",(budget or budget_th)[1])
        if found:
            field,value = found
            checked = validate_updates({field:value})
            updates.update(checked)
            quotes[field] = original
        else:
            unrecognized.append(original)
    return {"updates":updates,"source_quotes":quotes,"unrecognized":unrecognized}


def merge_profile(seed,updates):
    checked = validate_updates(updates)
    result = {**seed,**checked}
    if checked:
        result["origin"] = "synthetic_seed_with_user_stated_context"
    return result
