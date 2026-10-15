"""Numbers the way a person says them, in baht. Tools put these next to the exact numbers,
so the model copies "about 3.6 million baht" instead of "3,607,006 baht"."""


def baht(x: float, lang: str = "en") -> str:
    """2_729_983 -> 'about 2.7 million baht'. 139_618 -> 'about 140,000 baht'. 5 -> '5 baht'."""
    unit = "บาท" if lang == "th" else "baht"
    about = "ประมาณ " if lang == "th" else "about "
    a = abs(x)
    if a >= 1_000_000:
        millions = f"{a / 1_000_000:.1f}".rstrip("0").rstrip(".")
        return f"{about}{millions} {'ล้านบาท' if lang == 'th' else 'million baht'}"
    if a >= 10_000:
        return f"{about}{round(a, -3):,.0f} {unit}"
    if a >= 1_000:
        return f"{about}{round(a, -2):,.0f} {unit}"
    if a >= 100:
        return f"{a:,.0f} {unit}"
    return f"{a:,.2f}".rstrip("0").rstrip(".") + f" {unit}"


def exact_baht(x: float, lang: str = "en") -> str:
    """For amounts the user typed or will pay: 1000 -> '1,000 baht', 2.5 -> '2.50 baht'."""
    unit = "บาท" if lang == "th" else "baht"
    return f"{x:,.0f} {unit}" if float(x).is_integer() else f"{x:,.2f} {unit}"


def change(pct: float, lang: str = "en") -> str:
    """-23.97 -> 'down about 24%'. 0.42 -> 'up about 0.4%'."""
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
