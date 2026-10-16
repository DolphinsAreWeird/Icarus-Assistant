"""One server-owned demo bundle for screen prices, balances, fees and charts."""
from copy import deepcopy
import hashlib
import json

from app import knowledge
from app.market.history import period_rows
from app.model_snapshot import number

ASSETS = {"BTC": "btc", "ETH": "eth", "XAU": "gold"}
PERIODS = ("1D", "1W", "1M", "1Y")

# Stocks and funds the Invest screen lists to look at (the demo cannot buy them): app id -> (data id, ticker, badge letters, badge colour)
WATCHLIST = {"AAPL": ("aapl", "AAPL", "A", "#4A2E36"), "MSFT": ("msft", "MSFT", "M", "#2F6FDB"), "NVDA": ("nvda", "NVDA", "N", "#4C9A2A"),
             "GOOGL": ("googl", "GOOGL", "G", "#E8710A"), "AMZN": ("amzn", "AMZN", "a", "#232F3E"), "META": ("meta", "META", "M", "#0866FF"),
             "TSLA": ("tsla", "TSLA", "T", "#C8312E"), "BRK": ("brk", "BRK.B", "B", "#7A5C99"), "QQQ": ("qqq", "QQQ", "Q", "#1F7A8C")}
SPARK_POINTS = 24


def _spark(data_id):
    """The last month's daily closes, thinned to a small line for the list."""
    rows = period_rows(data_id, "1M")
    if len(rows) < 2:
        return []
    n = min(len(rows), SPARK_POINTS)
    return [number(rows[round(i * (len(rows) - 1) / (n - 1))]["close_thb"]) for i in range(n)]


def displayed_chart(asset_id, period):
    rows = period_rows(asset_id, period)
    if len(rows) < 2:
        return None
    n = min(len(rows), 48)
    selected = [rows[round(i * (len(rows) - 1) / (n - 1))] for i in range(n)]
    points = [{"at": r["t"], "price": number(r["close_thb"])} for r in selected]
    chart = {"asset_id": asset_id, "currency": "THB", "period": period.lower(),
             "points": points, "source": {"provider": "Binance + historical FX; USDT=USD approximation",
             "origin": "market", "delivery": "snapshot", "observed_at": points[-1]["at"],
             "source_url": None}}
    chart["display_version"] = hashlib.sha256(json.dumps(chart, sort_keys=True).encode()).hexdigest()[:24]
    return chart


def demo_bundle(cache, state, user_id):
    prices, fx = cache.freeze()
    with state.lock:
        user = deepcopy(state.users[user_id])
    assets = {}
    for app_id, data_id in ASSETS.items():
        if data_id not in prices:
            continue
        price = prices[data_id]
        assets[app_id] = {"price_thb": price["price_thb"], "as_of": price["as_of"],
                          "freshness": cache.freshness(price),
                          "charts": {p: chart for p in PERIODS if (chart := displayed_chart(data_id, p))}}
    watchlist = {}
    for app_id, (data_id, ticker, mono, bg) in WATCHLIST.items():
        price = prices.get(data_id)
        spark = _spark(data_id)
        if price and spark:
            watchlist[app_id] = {"name": knowledge.app_ui()["assets"][app_id]["name"], "ticker": ticker, "mono": mono, "bg": bg,
                                 "price_thb": price["price_thb"], "change_1d_pct": price["change_24h_pct"],
                                 "freshness": cache.freshness(price), "as_of": price["as_of"], "spark": [float(x) for x in spark]}
    return {"mode": "simulated", "currency": "THB", "user_id": user_id,
            "display_name": user["display_name"], "cash_thb": user["cash_thb"],
            "holdings": {a: user["holdings"].get(d, {}).get("qty", 0) for a, d in ASSETS.items()},
            "transactions": user["transactions"], "fees": knowledge.fees(), "assets": assets, "watchlist": watchlist,
            "notice": "Simulated account · saved reference prices · approximate THB · gold uses PAXG"}


def bind_screen(payload, context):
    """Resolve a chart version against server history; never accept client points/source."""
    if not context or context.screen_id not in ("asset", "asset_detail"):
        return
    asset_id = ASSETS.get(str(context.selected_asset).upper(), context.selected_asset)
    period = (context.chart_period or "").upper()
    if asset_id not in ASSETS.values() or period not in PERIODS or not context.screen_revision:
        return
    chart = displayed_chart(asset_id, period)
    if chart is None:
        return
    payload["screen"] = {"screen_id": context.screen_id, "screen_revision": context.screen_revision,
                         "selected_asset": asset_id, "focused_element": context.focused_element or "asset.chart",
                         "chart": chart}


def model_screen_context(context):
    if context is None:
        return None
    result = context.model_dump()
    result["selected_asset"] = ASSETS.get(str(context.selected_asset).upper(), context.selected_asset)
    result["chart_period"] = (context.chart_period or "").lower() or None
    result["focused_element"] = context.focused_element or "asset.chart"
    return result
