"""Fact packs: ready-to-say facts per asset, for fees and per user, computed in code.

Asset packs are rebuilt when prices change: the poller calls refresh() after each poll, and a
reader rebuilds them if it notices first. Answers read a pack instead of calling the data tools
one by one, and the model gets the relevant packs in its context instead of a tool round trip.
History summaries come from the snapshot files and are read once per run. `version` changes only
when something we would say changes; it keys the answer cache.
"""
import hashlib
import json
import threading
from types import SimpleNamespace

from app import display, knowledge, ui
from app.assistant.checks import first_sentences
from app.fees import trade_fee
from app.market.history import PERIODS, period_rows, summarize
from app.tools import _envelope, _providers

FEE_EXAMPLES = (500, 1000, 5000)
NAMES = {"XAU": {"en": "gold", "th": "ทองคำ"}, "BTC": {"en": "Bitcoin", "th": "บิตคอยน์"},
         "ETH": {"en": "Ethereum", "th": "อีเธอเรียม"}}
ABOUT_TH_MAX = 200  # Thai has no full stops: cap the description by length instead
PRICE_PROVIDER = "binance + frankfurter"   # the same labels the data tools use
HISTORY_PROVIDER = "binance history snapshot"


def name(app_id: str, lang: str) -> str:
    """An asset's name mid-sentence: "gold", "Bitcoin", "ทองคำ"."""
    if app_id in NAMES:
        return NAMES[app_id]["th" if lang == "th" else "en"]
    app = knowledge.app_ui()["assets"].get(app_id, {})
    named = knowledge.assets().get(app.get("data_id") or "")
    if lang == "th" and named:
        return named["name_th"].split(" (")[0]
    return app.get("name", app_id)


def _cap(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    cut = text.rfind(" ", 0, limit)
    return text[: cut if cut > 0 else limit].rstrip(" ,")


class FactPacks:
    def __init__(self, cache):
        self.cache = cache
        self._lock = threading.Lock()
        self._summaries: dict = {}
        self._stamp = None
        self.assets: dict[str, dict] = {}
        self.fees = self._fee_pack()
        self.version = ""
        self.refresh()

    # ---------- building ----------

    def refresh(self, block: bool = True) -> bool:
        """Rebuild the asset packs if the prices changed. Returns True if it rebuilt.
        With block=False it doesn't wait for a poll in progress (the cache is locked then)."""
        if not self.cache.lock.acquire(blocking=block):
            return False
        try:
            prices = self.cache.get_all()
        finally:
            self.cache.lock.release()
        stamp = json.dumps({k: [p["price_thb"], p["change_24h_pct"], p["as_of"], p["freshness"]]
                            for k, p in prices.items()}, sort_keys=True)
        with self._lock:
            if stamp == self._stamp:
                return False
            assets = {app_id: self._asset_pack(app_id, a["data_id"], prices.get(a["data_id"]))
                      for app_id, a in knowledge.app_ui()["assets"].items() if a["data_id"]}
            said = json.dumps([{k: v["say"] for k, v in assets.items()}, self.fees["say"]],
                              sort_keys=True, ensure_ascii=False)
            self.assets, self._stamp = assets, stamp
            self.version = hashlib.sha1(said.encode()).hexdigest()[:12]
        return True

    def current(self) -> "FactPacks":
        """The packs, rebuilt first if prices moved and no poll is holding the cache."""
        self.refresh(block=False)
        return self

    def _summary(self, data_id: str, period: str) -> dict | None:
        if (data_id, period) not in self._summaries:
            self._summaries[data_id, period] = summarize(period_rows(data_id, period))
        return self._summaries[data_id, period]

    def _asset_pack(self, app_id: str, data_id: str, price: dict | None) -> dict:
        history = {p: self._summary(data_id, p) for p in PERIODS}
        pack = {"asset_id": app_id, "price_thb": price["price_thb"] if price else None,
                "change_24h_pct": price["change_24h_pct"] if price else None,
                "as_of": price["as_of"] if price else None, "freshness": price["freshness"] if price else "n/a",
                "history": {p: s for p, s in history.items() if s}}
        info = knowledge.assets()[data_id]
        pack["say"] = {lang: self._say(app_id, info, pack, lang) for lang in ("en", "th")}
        return pack

    @staticmethod
    def _say(app_id: str, info: dict, pack: dict, lang: str) -> dict:
        say = {"name": name(app_id, lang)}
        if pack["price_thb"] is not None:
            say["price"] = display.baht(pack["price_thb"], lang)
            say["today_short"] = display.change(pack["change_24h_pct"], lang)          # "up about 0.4%"
            say["today"] = say["today_short"] + " " + display.period("1D", lang)      # "up about 0.4% today"
        for p, s in pack["history"].items():
            say[p + "_short"] = display.change(s["change_pct"], lang)
            say[p] = say[p + "_short"] + " " + display.period(p, lang)
            say[p + "_start"] = display.baht(s["start"]["close_thb"], lang)
            say[p + "_end"] = display.baht(s["end"]["close_thb"], lang)
        about = info["description_th"] if lang == "th" else info["description_en"]
        say["about"] = _cap(about, ABOUT_TH_MAX) if lang == "th" else first_sentences(about, 2)
        return say

    @staticmethod
    def _fee_pack() -> dict:
        f = knowledge.fees()
        examples = {str(a): trade_fee(a, f) for a in FEE_EXAMPLES}
        pack = {k: f[k] for k in ("trading_fee_pct", "min_fee_thb", "min_buy_thb", "mock")} | {
            "examples": examples, "example_amounts_thb": list(FEE_EXAMPLES)}
        pack["say"] = {lang: {"pct": f"{f['trading_fee_pct']:g}%", "min_fee": display.exact_baht(f["min_fee_thb"], lang),
                              "min_buy": display.exact_baht(f["min_buy_thb"], lang),
                              **{a: display.exact_baht(fee, lang) for a, fee in examples.items()}}
                       for lang in ("en", "th")}
        return pack

    # ---------- reading ----------

    def say(self, app_id: str, lang: str) -> dict:
        pack = self.assets.get(app_id)
        return pack["say"]["th" if lang == "th" else "en"] if pack else {}

    def portfolio(self, user: dict, lang: str) -> dict:
        """The user's cash, holdings at pack prices and biggest holding. Per request: it changes on confirm."""
        holdings, total = [], user["cash_thb"]
        for data_id, h in user["holdings"].items():
            if h["qty"] <= 0:
                continue
            app_id = ui.to_app_asset(data_id) or data_id
            price = (self.assets.get(app_id) or {}).get("price_thb")
            value = round(h["qty"] * price, 2) if price else None
            holdings.append({"asset_id": app_id, "qty": h["qty"], "value_thb": value})
            total += value or 0
        holdings.sort(key=lambda h: -(h["value_thb"] or 0))
        data = {"cash_thb": user["cash_thb"], "total_thb": round(total, 2), "holdings": holdings}
        say = {"cash": display.exact_baht(user["cash_thb"], lang), "total": display.baht(total, lang)}
        if holdings:
            say["biggest"] = name(holdings[0]["asset_id"], lang)
        return data | {"say": say}

    # ---------- sources ----------

    def cite(self, ctx, app_id: str, part: str, period: str | None = None) -> dict | None:
        """Add an envelope for the facts a reply used, so sources and the numbers check see them.
        part: price, history (with period), about or fees. ctx needs only a results dict."""
        lang = getattr(ctx, "lang", "en")
        if part == "fees":
            return _envelope(ctx, "get_fees", {k: v for k, v in self.fees.items() if k != "say"},
                             "fees.json (made-up demo fees)")
        pack = self.assets.get(app_id)
        if pack is None:
            return None
        say = self.say(app_id, lang)
        if part == "price":
            data = {app_id: {k: pack[k] for k in ("price_thb", "change_24h_pct", "as_of", "freshness")}
                    | {"say": {"price": say.get("price"), "change_24h": say.get("today")}}}
            return _envelope(ctx, "get_prices", data, _providers([knowledge.app_ui()["assets"][app_id]["data_id"]], "price"), pack["as_of"], pack["freshness"])
        if part == "history" and period in pack["history"]:
            s = pack["history"][period]
            data = {"asset_id": app_id, "period": period, "summary": s,
                    "say": {"change": say[period], "start": say[period + "_start"], "end": say[period + "_end"]}}
            return _envelope(ctx, "get_history", data, _providers([knowledge.app_ui()["assets"][app_id]["data_id"]], "history"), s["end"]["t"], "snapshot")
        if part == "about":
            return _envelope(ctx, "get_asset_info", {"asset_id": app_id, "name": say["name"], "description": say["about"]},
                             "assets.json (reviewed by us)")
        return None

    def for_model(self, app_ids: list[str], lang: str, fees: bool = False,
                  chart: tuple[str, str] | None = None) -> tuple[dict, list[dict]]:
        """Compact facts for the model's context, keyed by the names the user sees, and their envelopes
        (cite only those the reply used). app_ids, the assets this turn is about: what it is, price, today,
        and the past week, month and year. Every other asset: price and today, so "how's everything?"
        needs no tool. chart, (asset, period) of the chart on screen: its change, start and end. fees: the
        rule, with examples to do the math with."""
        facts, holder = {}, SimpleNamespace(results={}, lang=lang)
        about = list(dict.fromkeys(app_ids))
        for app_id in about + [a for a in self.assets if a not in about]:
            say = self.say(app_id, lang)
            pack = {k: say[k] for k in ("price", "today") if k in say}
            if chart and chart[0] == app_id and chart[1] in say:
                period = chart[1]
                pack["chart on screen"] = (f"{say[period]}, from {say[period + '_start']} to {say[period + '_end']}"
                                           if lang != "th" else
                                           f"{say[period]} จาก{say[period + '_start']} เป็น{say[period + '_end']}")
                self.cite(holder, app_id, "history", period)
            if app_id in about:  # the numbers first: a model leads with what comes first
                pack |= {k: say[k] for k in ("1W", "1M", "1Y", "about") if k in say}
            if not pack:
                continue
            if "price" in pack:
                self.cite(holder, app_id, "price")
            for p in ("1W", "1M", "1Y"):
                if p in pack:
                    self.cite(holder, app_id, "history", p)
            if "about" in pack:
                self.cite(holder, app_id, "about")
            facts[say["name"]] = pack
        if fees:
            say = self.fees["say"]["th" if lang == "th" else "en"]
            facts["fees"] = {"rule": f"{say['pct']} of the amount, at least {say['min_fee']}, included in what you pay",
                             "smallest_buy": say["min_buy"],
                             "examples": {f"on {display.exact_baht(a, lang)}": say[str(a)] for a in FEE_EXAMPLES}}
            self.cite(holder, "", "fees")
        return facts, list(holder.results.values())

    def money_for_model(self, user: dict, lang: str, snapshot: dict | None = None) -> tuple[dict, list[dict]]:
        """The user's own money for the model's context, as the app shows it, and its envelope."""
        holder, snap = SimpleNamespace(results={}, lang=lang), snapshot or {}
        if snap.get("portfolio") and snap.get("data_source") != "backend_demo":
            # The app shows its own demo portfolio: talk about what the user sees, like get_portfolio does.
            _envelope(holder, "get_portfolio", snap["portfolio"], "app screen (demo data)", freshness="screen")
            return {"on screen": snap["portfolio"]}, list(holder.results.values())
        pack = self.portfolio(user, lang)
        _envelope(holder, "get_portfolio", {k: v for k, v in pack.items() if k != "say"}, "demo account",
                  freshness="simulated")
        money = {"cash": pack["say"]["cash"], "invested": {
            name(h["asset_id"], lang): display.baht(h["value_thb"], lang) for h in pack["holdings"] if h["value_thb"]}
            or "nothing yet"}
        if pack["holdings"]:
            money["total"] = pack["say"]["total"]
        return money, list(holder.results.values())
