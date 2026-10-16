"""Data first: answer the common requests with the tools and plain code, before any model call.

parse() reads one request, English or Thai, into an Intent, or None. It is conservative: a pattern
must match the whole normalized message, and negation, conditions, several requests, assets the
tools don't have (the S&P 500, Tesla) or anything else unclear give None: the model answers.

run() does the intent. Screen actions and trade previews go through app.tools, so actions, cards,
sources and fees are exactly what the tool loop would produce; data answers read the fact packs.
The reply is one short sentence built from the tools' and packs' own "say" and "done" texts, with
no model call. Only a portfolio in a shape we can't phrase asks the model, once, with the facts in
its context and no tools.
"""
import inspect
import json
import os
import re
from dataclasses import dataclass, field, replace

from app import display, knowledge, ui
from app.assistant.llm import THINK
from app.assistant.normalize import NAMES, normalize, risky
from app.assistant.prompt import WORDING_PROMPT
from app.facts import name
from app.fees import trade_fee
from app.tools import TOOLS, _envelope

WORDING_MAX_TOKENS = 60


def enabled() -> bool:
    """FASTPATH=0 turns off every shortcut before the model: prepared answers, fast path, answer cache."""
    return os.getenv("FASTPATH", "1") != "0"


@dataclass
class Intent:
    kind: str
    args: dict = field(default_factory=dict)


# ---------- parsing ----------

_NAMES = "|".join(sorted(NAMES, key=len, reverse=True))
A = rf"(?P<a>{_NAMES})"
B = rf"(?P<b>{_NAMES})"
_VIEW_ONLY = "|".join(n for n, app_id in NAMES.items()
                      if not knowledge.assets()[knowledge.app_ui()["assets"][app_id]["data_id"]].get("tradable", True))
AMOUNT = r"(?P<n>\d+(?:\.\d{1,2})?) baht"
PERIOD = (r"(?P<p>(?:(?:over|in|during|for|from|this|the|past|last|a|one|1|3|three|7|12|24|30|all|time|days?|"
          r"weeks?|months?|years?|hours?|quarter|ever|1d|1w|1m|3m|1y) ?)+)")
TH_PERIODS = {"1 วัน": "1D", "วัน": "1D", "1 สัปดาห์": "1W", "สัปดาห์": "1W", "อาทิตย์": "1W", "7 วัน": "1W",
              "1 เดือน": "1M", "เดือน": "1M", "30 วัน": "1M", "3 เดือน": "3M", "สามเดือน": "3M", "1 ปี": "1Y",
              "ปี": "1Y", "หนึ่งปี": "1Y", "12 เดือน": "1Y", "3 ปี": "ALL", "ทั้งหมด": "ALL"}
TP = "(?P<p>" + "|".join(sorted(TH_PERIODS, key=len, reverse=True)) + ")"
TH_SPAN = rf"(?:ย้อนหลัง|ในช่วง|ใน|รอบ)?\s*{TP}\s*(?:ที่ผ่านมา|ที่แล้ว|นี้)?"
EN_PERIODS = {"day": "1D", "24 hours": "1D", "week": "1W", "7 days": "1W", "month": "1M", "30 days": "1M",
              "3 months": "3M", "three months": "3M", "quarter": "3M", "year": "1Y", "12 months": "1Y",
              "all time": "ALL", "3 years": "ALL", "three years": "ALL", "ever": "ALL",
              "1d": "1D", "1w": "1W", "1m": "1M", "3m": "3M", "1y": "1Y"}
FILLER = re.compile(r"^(?:(?:over|in|during|for|from|this|the|past|last|a|one|1) )+")
SCREENS = {"home": "home", "wallet": "wallets", "wallets": "wallets", "invest": "invest", "investments": "invest",
           "portfolio": "portfolio", "payment": "payments", "payments": "payments", "card": "card",
           "หน้าหลัก": "home", "โฮม": "home", "กระเป๋าเงิน": "wallets", "กระเป๋า": "wallets", "ลงทุน": "invest",
           "พอร์ต": "portfolio", "ชำระเงิน": "payments", "จ่ายเงิน": "payments", "บัตร": "card"}
ALL_ASSETS = ["XAU", "BTC", "ETH"]


def period_of(phrase: str | None, default: str | None = "1Y") -> str | None:
    """"over the past 3 months" -> "3M". None if it isn't a period we have."""
    if not phrase:
        return default
    if phrase in TH_PERIODS:
        return TH_PERIODS[phrase]
    return EN_PERIODS.get(FILLER.sub("", phrase.strip() + " ").strip())


def _asset(m: re.Match, key: str = "a") -> str | None:
    return NAMES.get(m.groupdict().get(key) or "")


def _trade(m, here):
    asset = _asset(m) or here
    side = "sell" if m["side"] in ("sell", "ขาย") else "buy"
    return asset and Intent("trade", {"asset_id": asset, "side": side, "amount_thb": float(m["n"])})


def _history(m, here):
    period = period_of(m.groupdict().get("p"))
    return period and Intent("history", {"asset_id": _asset(m), "period": period})


def _compare(m, here):
    assets, period = [_asset(m), _asset(m, "b")], period_of(m.groupdict().get("p"))
    return period and assets[0] != assets[1] and Intent("compare", {"asset_ids": assets, "period": period})


def _compare_all(m, here):
    period = period_of(m.groupdict().get("p"))
    return period and Intent("compare", {"asset_ids": ALL_ASSETS, "period": period})


def _period(m, here):
    period = period_of(m["p"], None)
    return period and Intent("period", {"period": period})


def _steps(topic):
    return lambda m, here: Intent("steps", {"topic": topic, "asset_id": _asset(m)})


def _one(kind):
    return lambda m, here: Intent(kind, {"asset_id": _asset(m)})


def _advice(m, here):
    """"Should I buy?" on gold's page is about gold."""
    return Intent("advice", {"asset_id": _asset(m) or here})


def _const(kind, **args):
    return lambda m, here: Intent(kind, dict(args))


def _freeze(m, here):
    return Intent("freeze", {"frozen": m["v"] in ("freeze", "lock", "block", "ล็อก", "อายัด", "ระงับ")})


def _hide(m, here):
    return Intent("hide", {"hidden": m["v"] in ("hide", "ซ่อน")})


def _screen(m, here):
    return Intent("screen", {"screen": SCREENS[m.groupdict().get("s") or "home"]})


# (patterns, builder). A pattern must match the whole normalized message; the first that builds an
# Intent wins, so advice comes first. Python's re allows a group name once per pattern, so
# alternatives that reuse one are separate patterns.
RULES = [
    # advice: never turned into anything else
    ([rf"should i (?:buy|sell|hold|keep|get|invest in)(?: some| more| any)?(?: {A})?(?: now| today| right now| yet)?",
      rf"is (?:it|now|today) a good time to (?:buy|sell|invest in)(?: {A})?(?: now| today)?",
      rf"is {A} a good (?:buy|investment|idea|choice)(?: now| today| right now)?",
      r"what should i (?:buy|sell|invest in)(?: now| today)?", r"which (?:one|asset|coin) should i (?:buy|pick|choose|invest in)",
      rf"will {A} go (?:up|down)(?: today| tomorrow| this year| soon)?", rf"is {A} (?:better|safer) than {B}",
      rf"ควร(?:ซื้อ|ขาย|ลงทุน|ถือ)(?:ใน)?\s*(?:{A})?\s*(?:ตอนนี้|วันนี้)?\s*(?:ไหม|ดีไหม|หรือเปล่า|หรือยัง)?",
      rf"{A}\s*(?:น่าซื้อ|น่าลงทุน|ควรซื้อ|ควรขาย)\s*(?:ไหม|หรือเปล่า)?", r"(?:ซื้อ|ลงทุน)(?:อะไร|ตัวไหน)ดี|ตัวไหนดี",
      rf"{A}\s*จะ(?:ขึ้น|ลง)\s*(?:ไหม|หรือเปล่า)?",
      # "I have 50,000 baht, what should I do with it?" and other ways of asking where to put money
      r"(?:i have|i ve got|i got) \d+(?:\.\d{1,2})? baht (?:what should i do(?: with it)?|where should i put it|what should i buy|what do i do with it)",
      r"what should i do with (?:my |this |the )?(?:money|cash|savings|it)(?: now| today)?",
      r"where should i (?:put|invest) (?:my )?(?:money|cash|savings)(?: now| today)?",
      r"how should i invest(?: my (?:money|cash|savings))?",
      r"มีเงิน\s*\d+(?:\.\d{1,2})?\s*บาท\s*(?:ควร)?(?:ทำอะไรดี|ลงทุนอะไรดี|ซื้ออะไรดี)"], _advice),
    # a minus amount: ask again, never read it as a buy
    ([r"(?:buy|purchase|get|put|invest|sell)(?: in)? -\d.*", r"(?:ซื้อ|ขาย|ลงทุน).*-\s*\d.*"], _const("bad_amount")),
    # stocks are on the Invest screen to look at; the demo only buys gold, Bitcoin and Ethereum
    ([r"(?:buy|purchase|get|sell|invest in)(?: \d+(?:\.\d{1,2})?(?: baht)?)?(?: (?:of|in|worth of))?(?: shares? of| stocks? of)? (?:"+_VIEW_ONLY+r")(?: shares?| stocks?)?(?: for \d+(?:\.\d{1,2})? baht)?",
      r"(?:ซื้อ|ขาย|ลงทุน)\s*(?:หุ้น)?\s*(?:"+_VIEW_ONLY+r")\s*.*"], _const("stocks")),
    # buy and sell: an amount in baht, and an asset (or the asset page the user is on)
    ([rf"(?P<side>buy|purchase|get|put|invest) {AMOUNT}(?: worth)?(?: (?:of|in|into) {A})?",
      rf"(?P<side>buy|purchase|get) {A} (?:for|with) {AMOUNT}",
      rf"(?P<side>sell) {AMOUNT}(?: worth)?(?: of {A})?",
      rf"(?P<side>ซื้อ|ลงทุน|ขาย)(?:ใน)?\s*(?:{A}\s*)?(?:จำนวน\s*)?{AMOUNT}",
      rf"(?P<side>ซื้อ|ลงทุน|ขาย)\s*{AMOUNT}\s*(?:ใน|ของ|เป็น)?\s*{A}"], _trade),
    # how-to steps
    ([rf"how (?:do|can|would|should) i (?:buy|purchase)(?: something| an asset| assets| crypto| stuff| {A})?",
      rf"(?:show me )?how to (?:buy|purchase)(?: {A})?", r"how does buying work",
      rf"(?:ซื้อ|ลงทุน)\s*(?:{A}\s*)?(?:ได้)?\s*ยังไง(?:บ้าง)?", rf"วิธี(?:การ)?ซื้อ(?:\s*{A})?"], _steps("buy")),
    ([r"how (?:do|can) i (?:freeze|lock|block) (?:my |the )?card", r"ล็อกบัตร\s*(?:ได้)?\s*ยังไง"], _steps("freeze_card")),
    ([r"how (?:do|can) i hide (?:my |the )?balances?", r"ซ่อนยอด(?:เงิน)?\s*(?:ได้)?\s*ยังไง"], _steps("hide_balance")),
    ([r"how (?:do|can) i read (?:a |the |this )?(?:price )?chart", r"อ่านกราฟ\s*(?:ได้)?\s*ยังไง"], _steps("read_chart")),
    ([r"how (?:do|can) i swap(?: crypto| coins| assets| tokens)?", r"(?:สวอป|แลกเหรียญ)\s*(?:ได้)?\s*ยังไง"], _steps("swap")),
    ([r"how (?:do|can) i (?:see|check|view) (?:what i own|my portfolio|my holdings)", r"ดูพอร์ต\s*(?:ได้)?\s*ยังไง"],
     _steps("check_portfolio")),
    # a guided walk-through of buying
    ([rf"(?:walk|guide|take) me through (?:buying|how to buy) {A}(?: step by step)?",
      rf"teach me (?:how )?to buy {A}(?: step by step)?", rf"(?:สอน|พา)ซื้อ\s*{A}(?:\s*ทีละขั้นตอน)?"], _one("guide")),
    # price and today's change ("ทองวันนี้" is today's price, not a chart)
    ([rf"(?:what is )?(?:the )?(?:current |live |latest )?price of {A}(?: today| now| right now)?",
      rf"(?:what is )?(?:the )?{A} (?:current |live |latest )?price(?: today| now| right now)?",
      rf"how much is {A}(?: worth)?(?: today| now| right now)?",
      rf"how is {A}(?: doing| going| looking| performing| trading)?(?: today| now| right now| at the moment)?",
      rf"how is (?:the )?{A} price(?: doing)?(?: today| now)?", rf"is {A} up or down(?: today)?",
      rf"(?:ราคา\s*)?{A}\s*(?:วันนี้|ตอนนี้|ล่าสุด)?\s*(?:ราคา)?\s*(?:เป็นยังไง(?:บ้าง)?|ยังไงบ้าง|เท่าไหร่|ขึ้นหรือลง|ขึ้นไหม|ลงไหม)",
      rf"ราคา\s*{A}\s*(?:วันนี้|ตอนนี้|ล่าสุด)?"], _one("price")),
    # compare, and one asset over a period: a chart card
    ([rf"compare {A} (?:and|with|to|vs|against) {B}(?: {PERIOD})?", rf"{A} vs {B}(?: {PERIOD})?",
      rf"how (?:did|have|do) {A} and {B} (?:do|done|perform|performed|compare)(?: {PERIOD})?",
      rf"(?:เปรียบเทียบ|เทียบ)\s*{A}\s*(?:กับ|และ|vs)\s*{B}(?:\s*{TH_SPAN})?"], _compare),
    ([rf"compare (?:all )?(?:the )?(?:assets|everything|all|prices)(?: {PERIOD})?",
      r"(?:เปรียบเทียบ|เทียบ)\s*(?:สินทรัพย์|ทุกตัว)(?:ทั้งหมด)?"], _compare_all),
    ([rf"how (?:did|has) {A} (?:do|done|perform|performed|been doing|been)(?: {PERIOD})?",
      rf"(?:show(?: me)? )?how {A} (?:did|has done|has been doing|performed)(?: {PERIOD})?",
      rf"(?:show(?: me)? )?{A} (?:performance|price history|history)(?: {PERIOD})?",
      rf"show(?: me)? {A}(?: chart)? (?:over|for|in) {PERIOD}", rf"{A} chart (?:over|for|in) {PERIOD}",
      rf"how is {A}(?: doing)? (?:over|in|this) {PERIOD}",
      rf"(?:ผลตอบแทน\s*)?{A}\s*{TH_SPAN}\s*(?:เป็นยังไง(?:บ้าง)?|ยังไงบ้าง|ขึ้นหรือลง)?",
      rf"ดู(?:กราฟ)?\s*{A}\s*ย้อนหลัง\s*{TP}"], _history),
    # open an asset's page (the Thai chip "ดูราคาทองคำ" opens it and says the price)
    ([rf"ดูราคา\s*{A}"], _one("show_price")),
    ([rf"(?:show(?: me)?|open|view|see|go to|take me to|bring up|pull up|switch to|look at)(?: the)? {A}(?: page| screen| chart)?",
      rf"(?:ดู|เปิด|ไปที่|ไปหน้า|เปิดหน้า)\s*(?:หน้า\s*)?{A}"], _one("show")),
    # what an asset is
    ([rf"(?:what is|what are|what exactly is|tell me about|explain|describe)(?: a| an)? {A}(?: exactly)?",
      rf"tell me what {A} is", rf"what does {A} mean", rf"{A}\s*(?:คือ|เป็น)?\s*อะไร", rf"{A}\s*หมายถึงอะไร",
      rf"(?:อธิบาย|เล่าเรื่อง)\s*{A}"], _one("info")),
    # what the chart on the asset page means
    ([r"what does (?:this|the) (?:chart|line|graph) (?:mean|show)", r"explain (?:this|the) (?:chart|line|graph)",
      r"กราฟนี้(?:หมายความว่า|หมายถึง|คือ)อะไร", r"อธิบายกราฟ(?:นี้)?"], _const("explain_chart")),
    # the chart's period
    ([rf"(?:(?:switch|change|set)(?: the chart)? to|show(?: me)?)(?: the)? {PERIOD}(?: chart| view)?", PERIOD,
      rf"(?:ดูย้อนหลัง|ย้อนหลัง|ดูกราฟ|เปลี่ยนเป็น|เปลี่ยนกราฟเป็น)\s*{TP}"], _period),
    # card, balances, back, cancel, screens
    ([r"(?P<v>freeze|lock|block|unfreeze|unlock|unblock) (?:my |the )?(?:debit |credit |visa )?card",
      r"(?P<v>ล็อก|อายัด|ระงับ|ปลดล็อก|ยกเลิกการล็อก)\s*บัตร(?:\s*ให้)?"], _freeze),
    ([r"(?P<v>hide|unhide|show|reveal) (?:my |the )?(?:balance|balances|money|numbers|amounts)",
      r"(?P<v>ซ่อน|แสดง|โชว์|เปิด)\s*(?:ยอดเงิน|ยอด|ตัวเลข)"], _hide),
    ([r"(?:go )?back(?: one screen| a screen| to the previous screen)?|previous screen",
      r"(?:ย้อน)?กลับ(?:ไป)?(?:หน้าก่อน(?:หน้า)?)?"], _const("back")),
    ([r"cancel(?: it| that| this| the (?:preview|trade|order|purchase|buy|card))?|nevermind|forget it",
      r"ยกเลิก(?:รายการ|การซื้อ|คำสั่ง|เลย)?"], _const("cancel")),
    ([r"(?:go to|open|take me to|navigate to|show me|switch to)(?: the| my)? (?P<s>home|wallets?|invest|investments|"
      r"portfolio|payments?|card)(?: screen| tab| page)?", r"go home",
      r"(?:ไปที่|เปิด|ไปหน้า|เปิดหน้า)\s*(?:หน้า)?\s*(?P<s>หน้าหลัก|โฮม|กระเป๋าเงิน|กระเป๋า|ลงทุน|พอร์ต|ชำระเงิน|จ่ายเงิน|บัตร)"],
     _screen),
    # the user's own money
    ([r"explain my portfolio|what is in my portfolio|what do i (?:own|have|hold)|how is my portfolio(?: doing)?|my portfolio",
      r"(?:อธิบาย)?พอร์ต\s*(?:เป็นยังไง(?:บ้าง)?|มีอะไรบ้าง)?|มีอะไรในพอร์ต"], _const("portfolio", style="explain")),
    ([r"what is my (?:balance|cash|total|net worth)|how much (?:money|cash|baht) do i have(?: left)?|my balance",
      r"(?:ฉัน|ผม)?\s*มีเงิน(?:อยู่)?\s*เท่าไหร่|ยอดเงิน\s*(?:เหลือ)?\s*เท่าไหร่"], _const("portfolio", style="balance")),
    # fees
    ([rf"(?:what is|how much is) the fee (?:for|on) {AMOUNT}", rf"fee (?:for|on) {AMOUNT}",
      rf"ค่าธรรมเนียม\s*(?:สำหรับ|ของ)?\s*{AMOUNT}", rf"(?:ซื้อ\s*)?{AMOUNT}\s*ค่าธรรมเนียม(?:เท่าไหร่)?"],
     lambda m, here: Intent("fees", {"amount_thb": float(m["n"])})),
    ([r"(?:what is |what are |how much is |how much are )?(?:the |your )?(?:trading )?(?:fees?|commission)"
      r"(?: (?:for|on|to) (?:buying|selling|trading|a trade|trades|a buy|a purchase))?",
      r"(?:is|are) there (?:any )?(?:fees?|commission)|how much does it cost to (?:buy|trade|sell)",
      r"ค่าธรรมเนียม\s*(?:เท่าไหร่|คิดยังไง|เป็นยังไง|กี่บาท)?|มีค่าธรรมเนียม(?:ไหม)?"], _const("fees")),
]
COMPILED = [(re.compile(pattern), build) for patterns, build in RULES for pattern in patterns]


def parse(text: str, here: str | None = None) -> Intent | None:
    """One request read into an Intent, or None when the model should answer. here is the asset whose
    page the user is on, for "buy 500 baht" without an asset."""
    norm = normalize(text)
    if not norm or risky(text, norm):
        return None
    for pattern, build in COMPILED:
        m = pattern.fullmatch(norm)
        if m:
            intent = build(m, here)
            if intent:
                return intent
    return None


# ---------- doing it, and saying what happened ----------

PERIOD_WORDS = {"en": {"1D": "one day", "1W": "one week", "1M": "one month", "3M": "three months", "1Y": "one year",
                       "ALL": "all time"},
                "th": {"1D": "1 วัน", "1W": "1 สัปดาห์", "1M": "1 เดือน", "3M": "3 เดือน", "1Y": "1 ปี", "ALL": "ทั้งหมด"}}
SCREEN_TH = {"home": "หน้าหลัก", "wallets": "กระเป๋าเงิน", "invest": "ลงทุน", "portfolio": "พอร์ต",
             "payments": "ชำระเงิน", "card": "บัตร"}


def _cap1(s: str) -> str:
    return s[:1].upper() + s[1:]


def _strip_period(change: str, period: str, lang: str) -> str:
    suffix = " " + display.period(period, lang)
    return change[: -len(suffix)] if change.endswith(suffix) else change


def _trade_text(intent: Intent, result: dict, lang: str) -> str:
    data, th = result.get("data", result), lang == "th"
    asset_name, amount = name(intent.args["asset_id"], lang), display.exact_baht(intent.args["amount_thb"], lang)
    if data.get("ok"):
        say = data["say"]
        if intent.args["side"] == "sell":
            return (f"นี่คือรายการขาย{asset_name} {amount} คุณจะได้รับ {say['you_get']} หลังหักค่าธรรมเนียม {say['fee']} "
                    "กดยืนยันบนการ์ดเพื่อขาย" if th else
                    f"Here's your preview: you sell {amount} of {asset_name} and get {say['you_get']} after a {say['fee']} "
                    "fee. Tap Confirm on the card to sell.")
        grams = say.get("grams")
        return (f"นี่คือรายการซื้อ{asset_name} {say['you_pay']}{f' ({grams})' if grams else ''} "
                f"รวมค่าธรรมเนียม {say['fee']}แล้ว กดยืนยันบนการ์ดเพื่อซื้อ" if th else
                f"Here's your preview: {say['you_pay']} of {asset_name}{f', {grams}' if grams else ''}, "
                f"with a {say['fee']} fee included. Tap Confirm on the card to buy.")
    reason = data.get("reason")
    if reason == "not_enough_cash":
        cash = display.exact_baht(data["cash_thb"], lang)
        return f"ยอดเงินของคุณมี {cash} ไม่พอสำหรับ {amount}" if th else f"You have {cash} in cash, which isn't enough for {amount}."
    if reason == "below_minimum":
        least = display.exact_baht(data["min_buy_thb"], lang)
        return f"ซื้อขั้นต่ำ {least} เลยเตรียมรายการ {amount} ไม่ได้" if th else f"The smallest buy is {least}, so I can't set up {amount}."
    if reason == "not_enough_holdings":
        if not data.get("held_value_thb"):
            return f"คุณยังไม่มี{asset_name}ให้ขาย" if th else f"You don't hold any {asset_name} to sell."
        held = display.baht(data["held_value_thb"], lang)
        return (f"คุณถือ{asset_name}ไม่พอ ตอนนี้มีมูลค่า{held}" if th else
                f"You don't hold enough {asset_name} for that; yours is worth {held}.")
    if reason == "no_price":
        return (f"ตอนนี้ยังไม่มีราคา{asset_name} เลยเตรียมรายการไม่ได้" if th else
                f"I don't have a price for {asset_name} right now, so I can't set that up.")
    return "ยังเตรียมรายการนี้ไม่ได้ ลองอีกครั้งนะ" if th else "I couldn't set that up just now; please try again."


def price_text(facts, ctx, asset: str, lang: str) -> str:
    """"Gold is about 139,000 baht, up about 0.4% today." from the pack, cited."""
    say, th = facts.say(asset, lang), lang == "th"
    if "price" not in say:
        return f"ตอนนี้ยังไม่มีราคา{name(asset, lang)}" if th else f"I don't have a live price for {name(asset, lang)} right now."
    facts.cite(ctx, asset, "price")
    if facts.assets[asset]["freshness"] == "live":
        return f"{say['name']}ตอนนี้ราคา{say['price']} {say['today']}" if th else f"{_cap1(say['name'])} is {say['price']}, {say['today']}."
    return (f"ราคาล่าสุดที่บันทึกไว้ของ{say['name']}คือ{say['price']} {say['today']}" if th else
            f"At the last saved price, {say['name']} is {say['price']}, {say['today']}.")


def _chart_text(result: dict, assets: list[str], period: str, lang: str) -> str | None:
    said = (result.get("data") or result).get("say") or {}
    if not all(said.get(a) for a in assets):
        return None
    th, names = lang == "th", [name(a, lang) for a in assets]
    changes = [said[a]["change"] for a in assets]
    if len(assets) == 1:
        return f"{names[0]}{changes[0]}" if th else f"{_cap1(names[0])} is {changes[0]}."
    short = [_strip_period(c, period, lang) for c in changes[:-1]]
    if th:
        return " ".join(f"{n}{c}" for n, c in zip(names[:-1], short)) + f" ส่วน{names[-1]}{changes[-1]}"
    head = ", ".join(f"{n} is {c}" for n, c in zip(names[:-1], short))
    return _cap1(f"{head} and {names[-1]} is {changes[-1]}.")


def _explain_chart_text(ctx, facts, lang: str) -> str | None:
    """The asset page's chart: its period's change, start and end. From our history, which is the series
    the app draws in backend mode, or from the app's own numbers when it sends its demo data."""
    snap, state = ctx.snapshot or {}, ctx.ui_state
    if state.screen != "asset":
        return None
    period = str(snap.get("period") or (ctx.screen.chart_period if ctx.screen else None) or "1M").upper()
    result = TOOLS["explain_element"](ctx, element_id="asset.chart")  # highlights it, like the tool loop
    asset_name, th = name(state.asset, lang), lang == "th"
    if not snap or snap.get("data_source") == "backend_demo":
        if period not in facts.assets.get(state.asset, {}).get("history", {}):
            return None
        say = facts.say(state.asset, lang)
        facts.cite(ctx, state.asset, "history", period)
        change, start, end = _strip_period(say[period], period, lang), say[period + "_start"], say[period + "_end"]
    else:
        said = ((result.get("data") or {}).get("numbers") or {}).get("say") or {}
        if not {"start", "end"} <= said.keys():
            return None
        change, start, end = said.get("change", ""), said["start"], said["end"]
    words = display.period(period, lang)
    if th:
        return " ".join(f"เส้นนี้คือราคา{asset_name}{words} {change} จาก{start} เป็น{end}".split())
    return f"This line shows {asset_name}'s price {words}{', ' + change if change else ''}: from {start} to {end}."


def _portfolio_text(intent: Intent, ctx, facts, lang: str, llm, user_text: str) -> tuple[str, int]:
    th, snap = lang == "th", ctx.snapshot or {}
    if intent.args.get("style") == "explain":
        TOOLS["highlight_element"](ctx, element_id="portfolio.allocation")
    if snap.get("portfolio") and snap.get("data_source") != "backend_demo":
        # The app shows its own demo portfolio: answer about what the user sees, like get_portfolio does.
        data = TOOLS["get_portfolio"](ctx)["data"]
        top = max(data.get("allocation") or [], key=lambda a: a.get("pct") or 0, default=None)
        if top and top.get("id") in knowledge.app_ui()["assets"] and top.get("pct") is not None:
            return (f"พอร์ตของคุณอยู่ใน{name(top['id'], lang)} {top['pct']:g}%" if th else
                    f"{top['pct']:g}% of your portfolio is in {name(top['id'], lang)}."), 0
        fallback = "ดูพอร์ตของคุณได้ที่หน้าพอร์ต" if th else "Your portfolio is on the Portfolio screen."
        return _word(llm, lang, data, user_text, fallback)
    pack = facts.portfolio(ctx.state.users[ctx.user_id], lang)
    _envelope(ctx, "get_portfolio", {k: v for k, v in pack.items() if k != "say"}, "demo account", freshness="simulated")
    say = pack["say"]
    if not pack["holdings"]:
        return (f"คุณมีเงินสด {say['cash']} และยังไม่ได้ลงทุน" if th else
                f"You have {say['cash']} in cash and nothing invested yet."), 0
    if intent.args.get("style") == "balance":
        return (f"คุณมีเงินสด {say['cash']} รวมเงินลงทุนแล้วทั้งหมด{say['total']}" if th else
                f"You have {say['cash']} in cash, and {say['total']} in total with your investments."), 0
    return (f"คุณมีทั้งหมด{say['total']} เป็นเงินสด {say['cash']} และลงทุนใน{say['biggest']}มากที่สุด" if th else
            f"You have {say['total']} in total, {say['cash']} of it in cash, and your biggest holding is {say['biggest']}."), 0


def _fees_text(intent: Intent, ctx, facts, lang: str) -> str:
    say, th = facts.fees["say"]["th" if lang == "th" else "en"], lang == "th"
    amount = intent.args.get("amount_thb")
    if amount is None:
        facts.cite(ctx, "", "fees")
        return (f"ในเดโมนี้ค่าธรรมเนียมคือ {say['pct']} ของจำนวนเงิน ขั้นต่ำ {say['min_fee']} หักจากเงินที่คุณใส่" if th else
                f"In this demo the fee is {say['pct']} of the amount, at least {say['min_fee']}, taken from what you put in.")
    fee = trade_fee(amount, knowledge.fees())
    _envelope(ctx, "get_fees", {k: v for k, v in facts.fees.items() if k != "say"} | {"amount_thb": amount, "fee_thb": fee},
              "fees.json (made-up demo fees)")
    amount_s, fee_s = display.exact_baht(amount, lang), display.exact_baht(fee, lang)
    return (f"ค่าธรรมเนียมสำหรับ {amount_s} คือ {fee_s} ({say['pct']} ขั้นต่ำ {say['min_fee']})" if th else
            f"The fee on {amount_s} is {fee_s}: {say['pct']} with a {say['min_fee']} minimum.")


def advice_text(asset: str | None, lang: str) -> str:
    if asset:
        n = name(asset, lang)
        return (f"เลือกแทนคุณไม่ได้นะ แต่ช่วยแสดงว่าราคา{n}ขึ้นลงอย่างไร หรืออธิบายว่า{n}คืออะไรได้" if lang == "th" else
                f"I can't pick for you, but I can show you how {n}'s price has moved or explain what it is.")
    return ("เลือกแทนคุณไม่ได้นะ แต่ช่วยอธิบายสินทรัพย์ในแอป หรือแสดงว่าราคาขึ้นลงอย่างไรได้" if lang == "th" else
            "I can't pick for you, but I can explain any asset in the app or show how its price has moved.")


def _word(llm, lang: str, facts: dict, user_text: str, fallback: str) -> tuple[str, int]:
    """One model call, no tools, the facts in its context. The fallback if it fails or says nothing."""
    if llm is None:
        return fallback, 0
    messages = [{"role": "system", "content": f"{WORDING_PROMPT}\n\nReply in {'Thai' if lang == 'th' else 'English'}.\n"
                                              f"Facts: {json.dumps(facts, ensure_ascii=False)}"},
                {"role": "user", "content": user_text}]
    kwargs = {"max_tokens": WORDING_MAX_TOKENS} if "max_tokens" in inspect.signature(llm.complete).parameters else {}
    try:
        msg, finish = llm.complete(messages, [], **kwargs)
    except Exception as e:  # noqa: BLE001  the fallback still answers
        print(f"[fastpath] wording call failed: {type(e).__name__}: {e}", flush=True)
        return fallback, 1
    text = THINK.sub("", msg.get("content") or "").strip()
    return (text if text and finish != "content_filter" and not msg.get("tool_calls") else fallback), 1


SCREEN_TOOLS = {"show": "show_asset", "show_price": "show_asset", "guide": "guide_me", "freeze": "set_card_frozen",
                "hide": "set_balances_hidden", "back": "go_back", "period": "change_chart_period", "screen": "go_to_screen"}
TOOL_ARGS = {"show_asset": ("asset_id",), "guide_me": ("asset_id",), "set_card_frozen": ("frozen",),
             "set_balances_hidden": ("hidden",), "go_back": (), "change_chart_period": ("period",), "go_to_screen": ("screen",)}


def run(intent: Intent, ctx, facts, lang: str, llm=None, user_text: str = "") -> tuple[str, int] | None:
    """Do the intent and say what happened. Returns (text, model calls), or None to hand over to the model
    with a fresh context (whatever this one collected is then dropped)."""
    th, kind, args = lang == "th", intent.kind, intent.args
    if kind == "trade":
        result = TOOLS["prepare_trade"](ctx, asset_id=args["asset_id"], side=args["side"], amount_thb=args["amount_thb"])
        return _trade_text(intent, result, lang), 0
    if kind == "advice":
        return advice_text(args.get("asset_id"), lang), 0
    if kind == "bad_amount":
        return ("จำนวนเงินต้องมากกว่าศูนย์นะ อยากใส่เท่าไหร่ดี" if th
                else "Amounts start above zero. How much would you like to put in?"), 0
    if kind == "stocks":
        return ("หุ้นอย่าง Tesla และ Apple ฉันดูราคาและกราฟให้ได้ แต่ในเดโมนี้ซื้อได้แค่ทองคำ บิตคอยน์ และอีเธอเรียม" if th
                else "I can show the price and chart of stocks like Tesla and Apple, but in this demo I can only buy gold, Bitcoin and Ethereum."), 0
    if kind == "price":
        return price_text(facts, ctx, args["asset_id"], lang), 0
    if kind == "info":
        facts.cite(ctx, args["asset_id"], "about")
        return facts.say(args["asset_id"], lang)["about"], 0
    if kind == "fees":
        return _fees_text(intent, ctx, facts, lang), 0
    if kind == "portfolio":
        return _portfolio_text(intent, ctx, facts, lang, llm, user_text)
    if kind == "explain_chart":
        text = _explain_chart_text(ctx, facts, lang)
        return (text, 0) if text else None
    if kind in ("history", "compare"):
        assets = args.get("asset_ids") or [args["asset_id"]]
        text = _chart_text(TOOLS["show_chart"](ctx, asset_ids=assets, period=args["period"]), assets, args["period"], lang)
        return (text, 0) if text else None
    if kind == "steps":
        plan = ctx
        if args.get("asset_id") and args["asset_id"] != ctx.ui_state.asset:
            # point the "show me" buttons at the asset they asked about, planned from off its page
            plan = replace(ctx, ui_state=ui.UIState("home", args["asset_id"]))
        if not TOOLS["show_steps"](plan, topic=args["topic"]).get("ok"):
            return None
        title = knowledge.howto()[args["topic"]]["th" if th else "en"]["title"]
        return (f"นี่คือ{title}ทีละขั้นตอน" if th else f"Here's {title[:1].lower() + title[1:]}, step by step."), 0
    if kind == "cancel":
        done = TOOLS["cancel_trade"](ctx)["done"]
        if th:
            done = "ยกเลิกรายการแล้ว ยังไม่มีการซื้อ" if done.startswith("Cancelled") else "ไม่มีรายการที่ต้องยกเลิก"
        return done, 0
    tool = SCREEN_TOOLS.get(kind)
    if tool is None:
        return None
    result = TOOLS[tool](ctx, **{k: args[k] for k in TOOL_ARGS[tool]})
    if not result.get("ok"):
        return None
    done, already = result["done"], result["done"].startswith("Nothing to change")
    if kind == "show_price":
        return price_text(facts, ctx, args["asset_id"], lang), 0
    if kind == "show":
        n = name(args["asset_id"], lang)
        if th:
            return (f"ตอนนี้อยู่ที่หน้า{n}แล้ว" if already else f"เปิดหน้า{n}ให้แล้ว"), 0
        return (f"You're already on the {knowledge.app_ui()['assets'][args['asset_id']]['name']} page." if already else done), 0
    if kind == "screen":
        where = SCREEN_TH[args["screen"]]
        if th:
            return (f"ตอนนี้อยู่ที่หน้า{where}แล้ว" if already else f"เปิดหน้า{where}ให้แล้ว"), 0
        return (f"You're already on the {args['screen']} screen." if already else done), 0
    if kind == "period":
        words = PERIOD_WORDS["th" if th else "en"][args["period"]]
        return (f"เปลี่ยนกราฟเป็น {words}แล้ว" if th else f"Switched the chart to {words}."), 0
    if th:
        return {"guide": f"เริ่มสอนซื้อ{name(args.get('asset_id') or '', lang)}ทีละขั้นตอนแล้ว ทำตามบนหน้าจอได้เลย",
                "freeze": "ล็อกบัตรให้แล้ว" if args.get("frozen") else "ปลดล็อกบัตรให้แล้ว",
                "hide": "ซ่อนยอดเงินให้แล้ว" if args.get("hidden") else "แสดงยอดเงินให้แล้ว",
                "back": "ย้อนกลับไปหน้าก่อนแล้ว"}[kind], 0
    return done, 0
