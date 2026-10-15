"""The tools the LLM can call. Two kinds:

- Data tools: every number Icarus says comes from one of these. Each result is
  wrapped in an envelope with a result_id and its source.
- UI tools: one per intent ("show an asset", "change the chart"...). The planner in
  ui.py turns each into the exact action sequence the app runs. The model never
  writes raw UI actions, and every action is checked against the closed set.
- prepare_trade: opens the asset's page and shows our preview card (our prices and
  fee). Only the user's tap on the card confirms, through POST /trades/{id}/confirm.
- show_chart and show_steps: a chart or a step-by-step list in the chat. Code builds
  both (from our price history, and from data/howto.json), never the model.

Everything is in baht. Numbers come with a "say" version ("about 3.6 million baht")
so the model doesn't read out "3,607,006".

Asset ids are the app's (BTC, ETH, XAU, AAPL, TSLA). Ids and values are enums in
the schemas, and the code checks them again, since not every model obeys the schema.
"""
import json
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app import display, knowledge, ui
from app.contracts import ScreenContext
from app.market.cache import PriceCache
from app.market.history import period_rows, summarize
from app.state import DemoState
from app.trades import TradeError, cancel_pending, portfolio, prepare_trade


@dataclass
class ToolContext:
    """Everything a tool may touch during one chat turn."""
    state: DemoState
    cache: PriceCache
    user_id: str
    lang: str
    screen: ScreenContext | None
    snapshot: dict | None = None                     # the app's own screen data, if it sent any
    ui_state: ui.UIState = field(default_factory=ui.UIState)
    results: dict = field(default_factory=dict)      # result_id -> envelope
    ui_actions: list = field(default_factory=list)


def tool_specs() -> list[dict]:
    a = knowledge.app_ui()
    asset = {"type": "string", "enum": list(a["assets"])}
    period = {"type": "string", "enum": a["periods"]}

    def spec(name, description, properties, optional=()):  # OpenAI function-calling format
        return {"type": "function", "function": {
            "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": [p for p in properties if p not in optional],
                           "additionalProperties": False}}}

    return [
        # ---- data ----
        spec("get_prices", "Live price in baht and 24h change for one or more assets.",
             {"asset_ids": {"type": "array", "items": asset}}),
        spec("get_history", "Price over a period: start, end, change, high and low, in baht.",
             {"asset_id": asset, "period": period}),
        spec("get_asset_info", "What an asset is, its unit, and when it can be sold.",
             {"asset_id": asset}),
        spec("explain_element",
             "Explain a part of the screen: what it shows, the terms on it, and its numbers. "
             "Also highlights it.",
             {"element_id": {"type": "string", "enum": list(a["elements"])}}),
        spec("get_portfolio", "The user's holdings, value and how their money is split.", {}),
        spec("show_chart",
             "Draw a small price chart in the chat, in baht. Use it when a picture helps: comparing "
             "2 or 3 assets, or a period the user isn't looking at. Not for simple questions. If the "
             "user is already on that asset's page, it switches the real chart instead.",
             {"asset_ids": {"type": "array", "items": asset}, "period": period}),
        spec("show_steps",
             "Show a short step-by-step list in the chat. Use it only for 'how do I...' questions "
             "about one of these topics.",
             {"topic": {"type": "string", "enum": list(knowledge.howto())}}),
        # ---- UI: one tool per intent ----
        spec("go_to_screen", "Open a main screen of the app: home, wallets, invest, portfolio, "
             "payments or card. Use for 'take me to', 'open', 'go to'.",
             {"screen": {"type": "string", "enum": list(a["screens"])}}),
        spec("go_back", "Go back one screen.", {}),
        spec("show_asset", "Open an asset's page, optionally on a chart period. Use for 'show me gold'.",
             {"asset_id": asset, "period": period}, optional=("period",)),
        spec("change_chart_period", "Switch the chart to another period: 1D, 1W, 1M, 3M, 1Y or ALL. "
             "Use for 'show one year', 'switch to a week'.",
             {"period": period}),
        spec("filter_assets", "Show only one kind of asset in the asset list. Use for 'only crypto'.",
             {"filter": {"type": "string", "enum": a["filters"]}}),
        spec("prepare_trade",
             "Set up a buy or sell: opens the asset's page and shows a preview card with the "
             "amount, fee and what the user gets. It does NOT trade: the user taps Confirm on the "
             "card. amount_thb is the total the user pays (buy) or the value sold (sell), fee "
             "included. Always call this for a buy or sell request, even if the amount looks "
             "wrong: it checks the balance and the minimum.",
             {"asset_id": asset, "side": {"type": "string", "enum": ["buy", "sell"]},
              "amount_thb": {"type": "number"}}),
        spec("cancel_trade", "Cancel the preview card that is open. Nothing is bought. "
             "Use for 'cancel', 'stop', 'never mind'.", {}),
        spec("guide_me", "Start a step-by-step walkthrough of buying an asset on the real screens. "
             "Use for 'walk me through', 'show me how', 'step by step'. Use it alone.",
             {"asset_id": asset}),
        spec("set_card_frozen", "Freeze (frozen=true) or unfreeze (frozen=false) the user's card. "
             "Use for 'freeze', 'lock', 'block', 'unfreeze', 'unlock' my card. You CAN do this.",
             {"frozen": {"type": "boolean"}}),
        spec("set_balances_hidden", "Hide (hidden=true) or show (hidden=false) balances on screen.",
             {"hidden": {"type": "boolean"}}),
        spec("highlight_element", "Point at a part of the app, going to its screen first if needed. "
             "Use for 'where is', 'where do I', 'show me where'.",
             {"element_id": {"type": "string", "enum": list(a["elements"])}}),
    ]


# ---------- helpers ----------

def _envelope(ctx: ToolContext, tool: str, data: dict, provider: str,
              as_of: str | None = None, freshness: str = "n/a") -> dict:
    env = {"result_id": "r_" + secrets.token_hex(3), "tool": tool, "data": data,
           "source": {"provider": provider, "as_of": as_of, "freshness": freshness}}
    ctx.results[env["result_id"]] = env
    return env


def _data_id(asset_id: str) -> str | None:
    """Our data id for an asset. Takes the app's id (XAU) or ours (gold)."""
    app_asset = ui.to_app_asset(asset_id)
    if app_asset is None:
        raise ValueError(f"unknown asset {asset_id}")
    return knowledge.app_ui()["assets"][app_asset]["data_id"]


def _price(ctx: ToolContext, app_asset: str) -> dict:
    data_id = _data_id(app_asset)
    p = ctx.cache.get(data_id) if data_id else None
    if p is None:
        return {"available": False, "note": "no live data for this asset"}
    out = {k: p[k] for k in ("price_thb", "change_24h_pct", "as_of", "freshness")}
    out["say"] = {"price": display.baht(p["price_thb"], ctx.lang),
                  "change_24h": display.change(p["change_24h_pct"], ctx.lang) + " "
                  + display.period("1D", ctx.lang)}
    return out


def _say_summary(s: dict | None, period: str, lang: str) -> dict | None:
    """Ready-to-say versions of a history summary."""
    if not s:
        return None
    return {"change": display.change(s["change_pct"], lang) + " " + display.period(period, lang),
            "start": display.baht(s["start"]["close_thb"], lang), "end": display.baht(s["end"]["close_thb"], lang),
            "high": display.baht(s["high"]["close_thb"], lang), "low": display.baht(s["low"]["close_thb"], lang)}


def _now_iso(ctx: ToolContext) -> str:
    return datetime.fromtimestamp(ctx.state.clock(), UTC).isoformat()


def _add_actions(ctx: ToolContext, actions: list[dict]) -> None:
    for action in actions:
        ui.validate(action)
    if len(ctx.ui_actions) + len(actions) > ui.MAX_ACTIONS_PER_TURN:
        raise ui.UIError("too_many_actions", "too many screen changes in one answer")
    ctx.ui_actions.extend(actions)


# ---------- data tools ----------

def get_prices(ctx: ToolContext, asset_ids: list[str]) -> dict:
    data = {a: _price(ctx, a) for a in asset_ids}
    live = [p for p in data.values() if p.get("freshness")]
    worst = next((f for f in ("offline", "delayed") if any(p["freshness"] == f for p in live)),
                 "live" if live else "n/a")
    as_of = max((p["as_of"] for p in live), default=None)
    return _envelope(ctx, "get_prices", data, "binance + frankfurter", as_of, worst)


def get_history(ctx: ToolContext, asset_id: str, period: str) -> dict:
    data_id = _data_id(asset_id)
    s = summarize(period_rows(data_id, period)) if data_id else None
    return _envelope(ctx, "get_history", {"asset_id": asset_id, "period": period, "summary": s,
                                          "say": _say_summary(s, period, ctx.lang)},
                     "binance history snapshot", s["end"]["t"] if s else None, "snapshot")


def get_asset_info(ctx: ToolContext, asset_id: str) -> dict:
    app_asset = knowledge.app_ui()["assets"][asset_id]
    data_id = app_asset["data_id"]
    if data_id is None:
        return _envelope(ctx, "get_asset_info", {"asset_id": asset_id, "name": app_asset["name"],
                                                 "note": "no details for this asset yet"}, "app_ui.json")
    a = knowledge.assets()[data_id]
    data = {"asset_id": asset_id, "name": a["name"] if ctx.lang == "en" else a["name_th"],
            "description": a["description_en"] if ctx.lang == "en" else a["description_th"],
            "unit": a["unit"], "grams_per_unit": a.get("grams_per_unit"), "sell_hours": a["sell_hours"]}
    return _envelope(ctx, "get_asset_info", data, "assets.json (reviewed by us)")


def explain_element(ctx: ToolContext, element_id: str) -> dict:
    element = knowledge.ui_elements()[element_id]
    glossary = knowledge.glossary()
    key = "explain_en" if ctx.lang == "en" else "explain_th"
    terms = [{"term": glossary[t][ctx.lang], "explanation": glossary[t][key]} for t in element["terms"]]
    snap = ctx.snapshot
    live, provider, freshness = None, "app_ui.json + glossary.json", "n/a"

    if snap and element["screen_data"]:
        # Explain what is on the screen, with the screen's own numbers.
        part = element["screen_data"]
        # The app sends every amount in baht (getContext in the prototype).
        chart = snap.get("chart") or {}
        live = {"chart": {"asset": (snap.get("asset") or {}).get("name"), "period": snap.get("period"),
                          "currency": "THB", **chart,
                          "say": {k: display.baht(v, ctx.lang) for k, v in chart.items()
                                  if k in ("start", "end", "high", "low") and isinstance(v, (int, float))}
                          | ({"change": display.change(chart["change_pct"], ctx.lang)}
                             if isinstance(chart.get("change_pct"), (int, float)) else {})},
                "asset": {"currency": "THB", **(snap.get("asset") or {})},
                "buy": snap.get("buy") and {"currency": "THB", **snap["buy"]},
                "portfolio": {"currency": "THB", **(snap.get("portfolio") or {})}}[part]
        provider, freshness = "app screen (demo data)", "screen"
    elif not snap:
        app_asset = ctx.ui_state.asset
        if element_id == "asset.chart" and _data_id(app_asset):
            period = (ctx.screen.chart_period if ctx.screen else None) or "1M"
            summary = summarize(period_rows(_data_id(app_asset), period))
            live = {"asset": app_asset, "period": period, "summary": summary,
                    "say": _say_summary(summary, period, ctx.lang)}
            freshness = "snapshot"
        elif element_id == "asset.change24h":
            live = _price(ctx, app_asset)
            freshness = live.get("freshness", "n/a")
        elif element_id.startswith(("buy.", )):
            fees = knowledge.fees()
            live = {k: fees[k] for k in ("trading_fee_pct", "min_fee_thb", "min_buy_thb", "mock")}
        elif element_id.startswith(("portfolio.", "invest.chart", "invest.portfolio_value", "home.")):
            live = portfolio(ctx.state.users[ctx.user_id], ctx.cache, _now_iso(ctx))

    try:  # highlight what we explain; skip quietly if it can't be shown right now
        _add_actions(ctx, ui.point_at(ctx.ui_state, element_id))
    except ui.UIError:
        pass
    data = {"element_id": element_id, "shows": element["shows"], "terms": terms, "numbers": live}
    return _envelope(ctx, "explain_element", data, provider, freshness=freshness)


def get_portfolio(ctx: ToolContext) -> dict:
    if ctx.snapshot and ctx.snapshot.get("portfolio"):
        # The app shows its own demo portfolio. Answer about what the user sees.
        return _envelope(ctx, "get_portfolio", ctx.snapshot["portfolio"], "app screen (demo data)",
                         freshness="screen")
    data = portfolio(ctx.state.users[ctx.user_id], ctx.cache, _now_iso(ctx))
    return _envelope(ctx, "get_portfolio", data, "demo account", freshness="simulated")


# ---------- UI tools ----------

def _ui_tool(planner):
    """Wrap a planner function: plan, check, add the actions, tell the model what happened."""
    def run(ctx: ToolContext, **args) -> dict:
        if any(a["type"] == "start_guide" for a in ctx.ui_actions):
            return {"ok": False, "reason": "guide_running",
                    "message": "A step-by-step guide is running. It moves the screens itself. "
                               "Don't describe anything else."}
        try:
            actions = planner(ctx.ui_state, **args)
            _add_actions(ctx, actions)
        except ui.UIError as e:
            return {"ok": False, "reason": e.code, "message": e.message}
        return {"ok": True, "done": ui.describe(actions) or "Nothing to change, already there."}
    return run


def prepare_trade_tool(ctx: ToolContext, asset_id: str, side: str, amount_thb: float) -> dict:
    data_id = _data_id(asset_id)
    if data_id is None:
        return {"ok": False, "reason": "no_data",
                "message": "this asset can't be traded through Icarus yet"}
    try:
        preview = prepare_trade(ctx.state, ctx.cache, ctx.user_id, data_id, side, amount_thb)
    except TradeError as e:
        return _envelope(ctx, "prepare_trade", {"ok": False, "reason": e.code, **e.details},
                         "demo account", freshness="simulated")
    # The card is built from the tool result, never from what the model writes.
    card = {k: v for k, v in preview.items() if k not in ("user_id", "status", "expires_at")}
    card["expires_in_s"] = knowledge.fees()["preview_expiry_s"]
    try:
        _add_actions(ctx, ui.show_asset(ctx.ui_state, ui.to_app_asset(asset_id))
                     + [{"type": "card", "card_type": "trade_preview", "data": card}])
    except ui.UIError as e:
        return {"ok": False, "reason": e.code, "message": e.message}
    say = {"fee": display.exact_baht(card["fee_thb"], ctx.lang)}
    if side == "buy":
        say["you_pay"] = display.exact_baht(card["you_pay_thb"], ctx.lang)
    else:
        say["you_get"] = display.exact_baht(card["you_get_thb"], ctx.lang)
    if card.get("grams"):
        say["grams"] = f"about {card['grams']:.2f} grams" if ctx.lang == "en" else f"ประมาณ {card['grams']:.2f} กรัม"
    return _envelope(ctx, "prepare_trade", {"ok": True, **card, "say": say,
                                            "next": "The user taps Confirm on the card. Nothing is bought yet."},
                     "demo account (simulated)", freshness=preview["freshness"])


CHART_POINTS = 40  # enough for a small chat chart, small enough to send every time


def _downsample(rows: list[dict], n: int = CHART_POINTS) -> list[dict]:
    if len(rows) <= n:
        return rows
    step = (len(rows) - 1) / (n - 1)
    return [rows[round(i * step)] for i in range(n)]


def show_chart(ctx: ToolContext, asset_ids: list[str], period: str) -> dict:
    """A chart card built from our price history. One asset: price in baht.
    Two or three: change in % from the start, so different prices fit one chart."""
    assets = list(dict.fromkeys(ui.to_app_asset(a) for a in asset_ids))
    if not assets or None in assets or len(assets) > 3:
        return {"ok": False, "reason": "bad_assets", "message": "pick 1 to 3 assets from the app"}
    if period not in knowledge.app_ui()["periods"]:
        return {"ok": False, "reason": "bad_period", "message": f"no period called {period!r}"}
    names = knowledge.app_ui()["assets"]
    missing = [a for a in assets if names[a]["data_id"] is None]
    if missing:
        return {"ok": False, "reason": "no_data",
                "message": f"no price history for {', '.join(names[a]['name'] for a in missing)}"}

    summaries = {a: summarize(period_rows(names[a]["data_id"], period)) for a in assets}
    said = {a: _say_summary(summaries[a], period, ctx.lang) for a in assets}

    # Already looking at this asset's chart: change the real one, don't draw a second.
    if len(assets) == 1 and ctx.ui_state.screen == "asset" and ctx.ui_state.asset == assets[0]:
        try:
            actions = ui.change_chart_period(ctx.ui_state, period) + ui.point_at(ctx.ui_state, "asset.chart")
            _add_actions(ctx, actions)
        except ui.UIError as e:
            return {"ok": False, "reason": e.code, "message": e.message}
        return _envelope(ctx, "show_chart", {"ok": True, "done": ui.describe(actions), "say": said},
                         "binance history snapshot", freshness="snapshot")

    series, unit = [], "THB" if len(assets) == 1 else "%"
    for a in assets:
        rows = _downsample(period_rows(names[a]["data_id"], period))
        if not rows:
            return {"ok": False, "reason": "no_data", "message": f"no history for {names[a]['name']}"}
        first = rows[0]["close_thb"]
        points = [[r["t"], r["close_thb"] if unit == "THB" else round((r["close_thb"] / first - 1) * 100, 2)]
                  for r in rows]
        series.append({"asset_id": a, "name": names[a]["name"], "points": points,
                       "change_pct": summaries[a]["change_pct"], "change_text": said[a]["change"]})
    title = " vs ".join(names[a]["name"] for a in assets)
    card = {"title": title, "period": period, "period_text": display.period(period, ctx.lang),
            "unit": unit, "series": series,
            "source": "Binance price history, in baht at each day's exchange rate"}
    try:
        _add_actions(ctx, [{"type": "card", "card_type": "chart", "data": card}])
    except ui.UIError as e:
        return {"ok": False, "reason": e.code, "message": e.message}
    return _envelope(ctx, "show_chart", {"ok": True, "shown": "a chart card", "say": said,
                                         "next": "Say the main change in one sentence. The chart shows the rest."},
                     "binance history snapshot", freshness="snapshot")


def show_steps(ctx: ToolContext, topic: str) -> dict:
    """A step-by-step card from data/howto.json. Each step can point at the element it talks about."""
    topics = knowledge.howto()
    if topic not in topics:
        return {"ok": False, "reason": "unknown_topic", "message": f"no steps for {topic!r}"}
    content = topics[topic]["th" if ctx.lang == "th" else "en"]
    steps = []
    for i, step in enumerate(content["steps"], start=1):
        show = []
        if step["element_id"]:
            try:  # plan from where the user is, without moving them now
                show = ui.point_at(ui.UIState(ctx.ui_state.screen, ctx.ui_state.asset), step["element_id"])
            except ui.UIError:
                show = []
        steps.append({"n": i, "title": step["title"], "text": step["text"], "show_me": show})
    card = {"title": content["title"], "topic": topic, "steps": steps}
    try:
        _add_actions(ctx, [{"type": "card", "card_type": "steps", "data": card}])
    except ui.UIError as e:
        return {"ok": False, "reason": e.code, "message": e.message}
    return {"ok": True, "shown": f"{len(steps)} steps: {content['title']}",
            "next": "Say one short sentence. Don't repeat the steps; they are on screen."}


def cancel_trade(ctx: ToolContext) -> dict:
    n = cancel_pending(ctx.state, ctx.user_id)
    return {"ok": True, "done": "Cancelled the preview. Nothing was bought." if n
            else "There was no open preview to cancel."}


TOOLS = {
    "get_prices": get_prices,
    "get_history": get_history,
    "get_asset_info": get_asset_info,
    "explain_element": explain_element,
    "get_portfolio": get_portfolio,
    "go_to_screen": _ui_tool(ui.go_to_screen),
    "go_back": _ui_tool(ui.go_back),
    "show_asset": _ui_tool(lambda s, asset_id, period=None: ui.show_asset(s, asset_id, period)),
    "change_chart_period": _ui_tool(ui.change_chart_period),
    "filter_assets": _ui_tool(ui.filter_assets),
    "show_chart": show_chart,
    "show_steps": show_steps,
    "prepare_trade": prepare_trade_tool,
    "cancel_trade": cancel_trade,
    "guide_me": _ui_tool(lambda s, asset_id: ui.guide_me(s, asset_id)),  # finalize() keeps it alone
    "set_card_frozen": _ui_tool(ui.set_card_frozen),
    "set_balances_hidden": _ui_tool(ui.set_balances_hidden),
    "highlight_element": _ui_tool(ui.point_at),
}


def run_tool(ctx: ToolContext, name: str, args: dict) -> str:
    """Run one tool call and return its result as JSON text for the model."""
    if name not in TOOLS:
        raise ValueError(f"unknown tool {name}")
    return json.dumps(TOOLS[name](ctx, **args), ensure_ascii=False)
