"""Pure model-side retrieval, policy inputs, and financial calculations. No server."""
from calendar import monthrange
from datetime import date
from decimal import Decimal, InvalidOperation, ROUND_CEILING, ROUND_HALF_UP
import json
import math
from pathlib import Path
import re
import statistics

ROOT = Path(__file__).resolve().parent
ASSETS = {"btc":"Bitcoin", "eth":"Ethereum", "gold":"PAX Gold"}


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def money(value, *, positive=False):
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        raise ValueError("INVALID_AMOUNT") from None
    if not result.is_finite() or result < 0 or result > Decimal("1000000000000") or (positive and result == 0):
        raise ValueError("INVALID_AMOUNT")
    if result != result.quantize(Decimal("0.01")):
        raise ValueError("CURRENCY_REQUIRES_AT_MOST_TWO_DECIMALS")
    return result


def formatted(value):
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def load_profile(name):
    profiles = read_json(ROOT / "data" / "profiles.json")
    if name not in profiles:
        raise ValueError("UNKNOWN_PROFILE")
    return profiles[name]


def retrieve(query, language="en", limit=5):
    """Small reviewed corpus: lexical aliases, including Thai substrings."""
    if language not in ("en", "th"):
        raise ValueError("UNKNOWN_LANGUAGE")
    lower = query.lower()
    # Explicit English aliases; avoid substring matches such as 'key' in 'monkey'.
    aliases = {"fees":"fee", "wallets":"wallet", "costs":"fee", "cost":"fee",
               "transactions":"transaction", "holdings":"portfolio", "risks":"risk",
               "redemption":"redeem", "comparison":"compare", "diversification":"divers"}
    lower = re.sub(r"[a-z]+",lambda match:aliases.get(match[0],match[0]),lower)
    records = read_json(ROOT / "knowledge" / "records.json")
    def match(term):
        if term.isascii():
            return bool(re.search(r"(?<![a-z0-9])" + re.escape(term) + r"(?![a-z0-9])", lower))
        return term in lower
    ranked = [(sum(match(term) for term in row["keywords"]), row) for row in records]
    ranked = sorted((item for item in ranked if item[0]), key=lambda item:-item[0])[:limit]
    return [{"id":row["id"], "text":row[language], "source_url":row["source_url"],
             "review_status":row["review_status"], "checked_on":row["checked_on"]} for _,row in ranked]


def guidance_context(profile):
    policy = read_json(ROOT / "policies" / "guidance.json")
    missing = [field for field in policy["required_for_personalization"] if profile.get(field) is None]
    essential = profile.get("essential_money") is True
    near_term = profile.get("horizon_months") is not None and profile["horizon_months"] <= 12
    return {"policy_version":policy["version"], "review_status":policy["status"],
            "missing_for_personalization":missing,
            "essential_near_term_conflict":essential and near_term,
            "outside_holdings_known":profile.get("outside_holdings_known", False),
            "note":"One-year flag is a conservative demo policy, not a validated suitability threshold."}


def fee_quote(budget_thb):
    budget = money(budget_thb, positive=True).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if budget < 100:
        raise ValueError("MINIMUM_BUDGET_100_THB")
    fee = max(budget * Decimal("0.0025"), Decimal("5")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return {"origin":"synthetic", "currency":"THB", "budget":formatted(budget),
            "fee":formatted(fee), "purchase_amount":formatted(budget-fee),
            "fee_policy":"Mock: 0.25% of total budget, minimum 5 THB. Budget includes fee.",
            "execution":"none", "source_ids":["mock_app_rules"]}


def portfolio(profile):
    positions = profile.get("positions_thb")
    if not positions:
        return {"status":"unavailable", "reason":"No portfolio fixture for this profile; no holdings inferred."}
    values = {key:money(value) for key,value in positions.items()}
    total = sum(values.values(), Decimal(0))
    return {"origin":"synthetic", "currency":"THB", "total_including_cash":formatted(total),
            "positions":[{"asset":key, "value":formatted(value),
                          "share_pct":formatted(value/total*100) if total else "0.00"} for key,value in values.items()],
            "scope":"Visible fictional account only, including cash. Values are fixed THB fixtures, not live market valuations.",
            "source_ids":["diversification"]}


def goal_math(target_thb, current_thb, target_date, today):
    target, current = money(target_thb), money(current_thb)
    deadline, start = date.fromisoformat(target_date), date.fromisoformat(today)
    if deadline < start:
        raise ValueError("DEADLINE_IN_PAST")
    count = 0
    year, month = start.year, start.month
    # Contributions today and monthly on the original day (clamped to month end).
    while date(year, month, min(start.day, monthrange(year,month)[1])) <= deadline:
        count += 1
        year, month = (year+1,1) if month == 12 else (year,month+1)
        if count > 1200:
            raise ValueError("DEADLINE_TOO_DISTANT")
    gap = max(target-current, Decimal(0))
    payment = (gap/count).quantize(Decimal("0.01"),rounding=ROUND_CEILING)
    return {"currency":"THB", "target":formatted(target), "current":formatted(current),
            "contributions":count,"per_contribution":str(payment),"today":today,"deadline":target_date,
            "assumptions":"No interest or investment returns; first contribution today; monthly anniversaries clamped to month end."}


def history(asset_id):
    if asset_id not in ASSETS:
        raise ValueError("UNKNOWN_ASSET")
    path = ROOT / "data" / "market" / f"{asset_id}.json"
    if not path.exists():
        raise ValueError("HISTORY_UNAVAILABLE")
    result = read_json(path)
    if result.get("gaps"):
        raise ValueError("HISTORY_HAS_GAPS")
    return result


def history_summary(asset_id):
    data = history(asset_id)
    points = data["points"]
    closes = [float(row["close"]) for row in points]
    changes = [b/a-1 for a,b in zip(closes,closes[1:])]
    return {"asset_id":asset_id,"currency":data["currency"],"origin":data["origin"],
            "source_url":data["source_url"],"coverage_start":data["coverage_start"],"coverage_end":data["coverage_end"],
            "observations":len(points),"first_close":points[0]["close"],"last_historical_close":points[-1]["close"],
            "period_change_pct":round((closes[-1]/closes[0]-1)*100,4),
            "median_absolute_daily_move_pct":round(statistics.median(abs(value)*100 for value in changes),4),
            "limit":"Historical exchange-specific USDT series. Not a live quote or THB return."}


def compare_assets(asset_a, asset_b):
    a,b = history(asset_a),history(asset_b)
    start, end = max(a["coverage_start"],b["coverage_start"]), min(a["coverage_end"],b["coverage_end"])
    if start >= end:
        raise ValueError("NO_COMMON_HISTORY")
    result = []
    for asset,data in ((asset_a,a),(asset_b,b)):
        points = [row for row in data["points"] if start <= row["date"] <= end]
        prices = [float(row["close"]) for row in points]
        changes = [y/x-1 for x,y in zip(prices,prices[1:])]
        result.append({"asset_id":asset,"period_change_pct":round((prices[-1]/prices[0]-1)*100,4),
                       "median_absolute_daily_move_pct":round(statistics.median(abs(r)*100 for r in changes),4)})
    return {"currency":"USDT","origin":"real_historical","start":start,"end":end,"assets":result,
            "source_url":"https://data.binance.vision/", "limit":"Same date range; no forward return estimate or liquidity/fee comparison."}


def what_if(asset_id, amount_usdt, start_date, end_date):
    amount = money(amount_usdt,positive=True)
    data = history(asset_id)
    lookup = {row["date"]:row for row in data["points"]}
    if start_date >= end_date or start_date not in lookup or end_date not in lookup:
        raise ValueError("EXACT_DATES_UNAVAILABLE")
    first,last = Decimal(lookup[start_date]["close"]),Decimal(lookup[end_date]["close"])
    quantity = amount/first
    return {"asset_id":asset_id,"currency":"USDT","amount":formatted(amount),"start":start_date,"end":end_date,
            "start_close":str(first),"end_close":str(last),"hypothetical_quantity":str(quantity),
            "end_value":formatted(quantity*last),"change_pct":formatted((last/first-1)*100),
            "origin":"hypothetical_calculation_on_real_history","fees_included":False,
            "source_url":data["source_url"],"limit":"Daily reference closes, no spread/slippage/fees, no THB conversion, not actual performance."}


def risk_forecast(asset_id):
    if asset_id not in ASSETS:
        raise ValueError("UNKNOWN_ASSET")
    path = ROOT / "data" / "forecasts" / f"{asset_id}.json"
    if not path.exists():
        return {"status":"unavailable", "reason":"Risk baseline has not been evaluated yet."}
    return read_json(path)


def invoke(name, args, profile, today):
    """Strict allowlist. Identity/context are supplied by caller, never model arguments."""
    functions = {
        "calculate_fee": (fee_quote,{"budget_thb"}),
        "get_portfolio": (lambda:portfolio(profile),set()),
        "goal_math": (lambda target_thb,current_thb,target_date:goal_math(target_thb,current_thb,target_date,today),{"target_thb","current_thb","target_date"}),
        "get_history_summary":(history_summary,{"asset_id"}),
        "compare_assets":(compare_assets,{"asset_a","asset_b"}),
        "what_if":(what_if,{"asset_id","amount_usdt","start_date","end_date"}),
        "get_risk_forecast":(risk_forecast,{"asset_id"}),
    }
    if name not in functions or not isinstance(args,dict):
        raise ValueError("UNKNOWN_TOOL")
    function, keys = functions[name]
    if set(args) != keys:
        raise ValueError("INVALID_TOOL_ARGUMENTS")
    try:
        return function(**args)
    except (ValueError,TypeError,KeyError,ArithmeticError) as exc:
        return {"status":"error", "code":str(exc), "no_action_executed":True}


def fee_text(result, language):
    if language == "th":
        return f"งบรวม {result['budget']} บาท รวมค่าธรรมเนียมจำลอง {result['fee']} บาท เหลือซื้อสินทรัพย์ {result['purchase_amount']} บาท ยังไม่มีการซื้อขายจริง"
    return f"Your {result['budget']} THB budget includes a simulated {result['fee']} THB fee, leaving {result['purchase_amount']} THB to buy the asset. No trade was executed."


def render_tool_data(name, data, language):
    """Bind financial numbers to named fields and units; never trust LLM numeric prose."""
    th = language == "th"
    if data.get("status") in ("error","unavailable"):
        return "ข้อมูลสำหรับการคำนวณนี้ไม่พร้อม" if th else "Data for this calculation is unavailable."
    if name == "calculate_fee":
        return fee_text(data,language)
    if name == "get_portfolio":
        unit = data["currency"]
        items = "; ".join(f"{row['asset']}: {row['value']} {unit} ({row['share_pct']}%)" for row in data["positions"])
        if data["origin"]=="synthetic":
            prefix = "พอร์ตจำลองที่เห็น รวมเงินสด" if th else "Visible synthetic portfolio, including cash"
        else:
            prefix = "มูลค่าบัญชีที่ระบบส่งมา รวมเงินสด" if th else "Caller-supplied visible account values, including cash"
        result = f"{prefix}: {data['total_including_cash']} {unit}. {items}"
        if "source" in data:
            result += f" | {data['source']['observed_at']}; {data['source']['delivery']}; {data['freshness']}"
        return result
    if name == "get_prices":
        pieces = []
        for row in data["prices"]:
            source = row["source"]
            label = "จำลอง" if th and source["origin"]=="synthetic" else ("simulated" if source["origin"]=="synthetic" else ("ข้อมูลตลาดอ้างอิง" if th else "market reference"))
            pieces.append(f"{row['asset_id']}: {row['price']} {row['currency']}; {label}; {row['freshness']}; {source['delivery']}; {source['observed_at']}")
        return " | ".join(pieces) + (" ไม่ใช่ราคาเสนอซื้อขายที่ดำเนินการได้" if th else ". Not an executable quote.")
    if name == "explain_displayed_chart":
        label = "กราฟจำลอง" if th and data["source"]["origin"]=="synthetic" else ("Simulated chart" if data["source"]["origin"]=="synthetic" else ("กราฟที่แสดง" if th else "Displayed chart"))
        return f"{label} {data['asset_id']} ({data['display_version']}): {data['start']} → {data['end']}; {data['first_displayed_price']} → {data['last_displayed_price']} {data['currency']}; {data['displayed_change_pct']}%. " + ("ใช้จุดข้อมูลที่ส่งมาจากหน้าจอ ไม่ใช่ราคาปัจจุบัน" if th else "Uses supplied displayed points, not a current execution price.")
    if name == "goal_math":
        if th:
            return f"เป้าหมาย {data['target']} THB มีแล้ว {data['current']} THB: ออมครั้งละ {data['per_contribution']} THB จำนวน {data['contributions']} ครั้ง เริ่ม {data['today']} ถึง {data['deadline']} ไม่รวมดอกเบี้ยหรือผลตอบแทน"
        return f"Target {data['target']} THB; current savings {data['current']} THB: {data['per_contribution']} THB per contribution, {data['contributions']} contributions from {data['today']} through {data['deadline']}. No interest or investment return assumed."
    if name == "compare_assets":
        details = "; ".join(f"{row['asset_id']}: {row['period_change_pct']}% / {row['median_absolute_daily_move_pct']}%" for row in data["assets"])
        label = "การเปลี่ยนแปลงทั้งช่วง / ค่ามัธยฐานการแกว่งรายวันแบบค่าสัมบูรณ์" if th else "Period change / median absolute daily move"
        return f"{label}, {data['start']} – {data['end']}, {data['currency']}: {details}. " + ("ข้อมูลย้อนหลัง ไม่ใช่การพยากรณ์" if th else "Historical observations, not a forecast.")
    if name == "what_if":
        if th:
            return f"สมมติซื้อ {data['asset_id']} ด้วย {data['amount']} USDT วันที่ {data['start']} มูลค่า ณ {data['end']} เท่ากับ {data['end_value']} USDT เปลี่ยนแปลง {data['change_pct']}% ไม่รวมค่าธรรมเนียมและส่วนต่างราคา ไม่ใช่ผลตอบแทนจริง"
        return f"Hypothetical {data['asset_id']} purchase: {data['amount']} USDT on {data['start']}, valued at {data['end_value']} USDT on {data['end']} ({data['change_pct']}%). Fees and slippage excluded; not actual performance."
    if name == "get_history_summary":
        return f"{data['asset_id']}, {data['coverage_start']} – {data['coverage_end']}: " + (
            f"ราคาปิดย้อนหลังล่าสุด {data['last_historical_close']} USDT เปลี่ยนแปลงทั้งช่วง {data['period_change_pct']}% ไม่ใช่ราคาปัจจุบัน" if th else
            f"last historical close {data['last_historical_close']} USDT; period change {data['period_change_pct']}%. Not a current quote.")
    if name == "get_risk_forecast":
        interval = data.get("return_interval", {})
        extra = ""
        if "next_day_simple_return_interval_pct" in interval:
            bounds = interval["next_day_simple_return_interval_pct"]
            test = interval["test_metrics"]["selected_calibrated"]
            coverage = round(test["empirical_coverage_pct"], 2)
            if th:
                extra = (f" ช่วงผลตอบแทนวันถัดไปแบบทดลอง {bounds['lower']}% ถึง {bounds['upper']}% "
                         f"เป้าหมายความครอบคลุม {interval['nominal_coverage_pct']}%; "
                         f"ครอบคลุมจริงในการทดสอบ {coverage}% จาก {test['observations']} วัน "
                         "ผลจริงอาจอยู่นอกช่วงนี้ ไม่ใช่ขอบเขตขาดทุนสูงสุด")
            else:
                extra = (f" Experimental next-day return interval {bounds['lower']}% to {bounds['upper']}%; "
                         f"nominal coverage target {interval['nominal_coverage_pct']}%, "
                         f"observed test coverage {coverage}% across {test['observations']} days. "
                         "Actual returns can fall outside this range; it is not a maximum loss bound.")
        if th:
            return f"{ASSETS[data['asset_id']]}: แบบทดลอง ณ {data['as_of']} สำหรับวันถัดไป ในหน่วยผลตอบแทน USDT: ความผันผวนรายวันจาก rolling {data['rolling_20_next_day_volatility_pct']}%; EWMA {data['ewma_094_next_day_volatility_pct']}% ไม่บอกทิศทาง ไม่ใช่การคาดการณ์ ณ วันนี้หรือขอบเขตขาดทุนที่รับประกัน" + extra
        return f"{ASSETS[data['asset_id']]}: experimental next-day risk at historical cutoff {data['as_of']}, using USDT returns: rolling daily volatility {data['rolling_20_next_day_volatility_pct']}%; EWMA {data['ewma_094_next_day_volatility_pct']}%. No direction prediction, current forecast, or guaranteed loss bound." + extra
    raise ValueError("NO_REVIEWED_NUMERICAL_RENDERER")


def tool_schemas():
    definitions = [
        ("calculate_fee","Calculate the explicitly mock platform fee; not an execution preview.",{"budget_thb":"string"}),
        ("get_portfolio","Read visible synthetic account concentration; not live valuations.",{}),
        ("goal_math","No-interest savings contributions starting today; THB amounts.",{"target_thb":"string","current_thb":"string","target_date":"string"}),
        ("get_history_summary","Read available historical USDT statistics. No live prices.",{"asset_id":"string"}),
        ("compare_assets","Compare real historical changes over a common range; no recommendation verdict.",{"asset_a":"string","asset_b":"string"}),
        ("what_if","Historical hypothetical purchase in USDT ONLY, using exact available dates and no fees.",{"asset_id":"string","amount_usdt":"string","start_date":"string","end_date":"string"}),
        ("get_risk_forecast","Read an experimental forecast at the saved historical cutoff; never a current trade signal.",{"asset_id":"string"}),
    ]
    tools = []
    for name,description,params in definitions:
        properties = {key:{"type":kind} for key,kind in params.items()}
        for key in ("asset_id","asset_a","asset_b"):
            if key in properties:
                properties[key]["enum"] = list(ASSETS)
        tools.append({"type":"function","function":{"name":name,"description":description,
                     "parameters":{"type":"object","properties":properties,"required":list(params),"additionalProperties":False}}})
    return tools
