"""Numbers the way a person says them, in baht. Tools put these next to the exact numbers,
so the model copies "about 3.6 million baht" instead of "3,607,006 baht"."""


import math
from decimal import ROUND_HALF_UP, Decimal


def _round_to(a: float, step: int) -> int:
    """Round half up to a multiple of step (Python's round() goes to even: 1050 -> 1000)."""
    return int((Decimal(str(a)) / step).quantize(Decimal(1), rounding=ROUND_HALF_UP)) * step


def baht(x: float, lang: str = "en") -> str:
    """2_729_983 -> 'about 2.7 million baht'. 139_618 -> 'about 140,000 baht'. 5 -> '5 baht'. -1500 -> 'minus about 1,500 baht'."""
    th = lang == "th"
    if not isinstance(x, (int, float)) or isinstance(x, bool) or not math.isfinite(x):
        return "ไม่มีข้อมูล" if th else "not available"
    unit = "บาท" if th else "baht"
    about = "ประมาณ " if th else "about "
    sign = ("ลบ " if th else "minus ") if x < 0 else ""
    a = abs(x)
    if a >= 1e12:
        return f"{sign}{about}{a / 1e12:.1f}".rstrip("0").rstrip(".") + (" ล้านล้านบาท" if th else " trillion baht")
    if a >= 1e9:
        return f"{sign}{about}{f'{a / 1e9:.1f}'.rstrip('0').rstrip('.')} {'พันล้านบาท' if th else 'billion baht'}"
    if a >= 1_000_000 or _round_to(a, 1000) >= 1_000_000:  # 999,999.5 is "about 1 million", not "1,000,000"
        a = max(a, 1_000_000.0)
        millions = f"{a / 1_000_000:.1f}".rstrip("0").rstrip(".")
        return f"{sign}{about}{millions} {'ล้านบาท' if th else 'million baht'}"
    if a >= 10_000:
        return f"{sign}{about}{_round_to(a, 1000):,} {unit}"
    if a >= 1_000:
        return f"{sign}{about}{_round_to(a, 100):,} {unit}"
    if a >= 100:
        return f"{sign}{a:,.0f} {unit}"
    return f"{sign}{a:,.2f}".rstrip("0").rstrip(".") + f" {unit}"


def exact_baht(x: float, lang: str = "en") -> str:
    """For amounts the user typed or will pay: 1000 -> '1,000 baht', 2.5 -> '2.50 baht'."""
    unit = "บาท" if lang == "th" else "baht"
    return f"{x:,.0f} {unit}" if float(x).is_integer() else f"{x:,.2f} {unit}"


def size(pct: float) -> str:
    """The size of a percentage, the way people say it: 23.97 -> '24', 0.42 -> '0.4'."""
    a = abs(pct)
    return f"{a:.0f}" if a >= 10 else f"{a:.1f}".rstrip("0").rstrip(".")


def change(pct: float, lang: str = "en") -> str:
    """-23.97 -> 'down about 24%'. 0.42 -> 'up about 0.4%'."""
    if not isinstance(pct, (int, float)) or isinstance(pct, bool) or not math.isfinite(pct):
        return "ไม่มีข้อมูล" if lang == "th" else "not available"
    a = abs(pct)
    size = f"{a:.0f}" if a >= 10 else f"{a:.1f}".rstrip("0").rstrip(".")
    if size in ("0", ""):
        return "แทบไม่เปลี่ยน" if lang == "th" else "about flat"
    if lang == "th":
        return f"{'ขึ้น' if pct > 0 else 'ลง'}ประมาณ {size}%"
    return f"{'up' if pct > 0 else 'down'} about {size}%"


PERIOD_WORDS = {
    "en": {"1D": "today", "1W": "over the past week", "1M": "over the past month",
           "3M": "over the past 3 months", "1Y": "over the past year", "ALL": "over the past 3 years"},
    "th": {"1D": "วันนี้", "1W": "ในสัปดาห์ที่ผ่านมา", "1M": "ในเดือนที่ผ่านมา",
           "3M": "ใน 3 เดือนที่ผ่านมา", "1Y": "ในปีที่ผ่านมา", "ALL": "ใน 3 ปีที่ผ่านมา"},
}


def period(p: str, lang: str = "en") -> str:
    return PERIOD_WORDS["th" if lang == "th" else "en"].get(p, p)
