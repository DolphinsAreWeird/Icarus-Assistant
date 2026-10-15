"""The tools the LLM can call. Two kinds:

- Data tools: every number Icarus says comes from one of these. Each result is
  wrapped in an envelope with a result_id and its source.
- UI tools: one per intent ("show an asset", "prepare a buy"...). The planner in
  ui.py turns each into the exact action sequence the app runs. The model never
  writes raw UI actions, and every action is checked against the closed set.

Asset ids are the app's (BTC, ETH, XAU, AAPL, TSLA). Ids and values are enums in
the schemas, and the code checks them again, since not every model obeys the schema.
"""
import json
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app import knowledge, ui
from app.contracts import ScreenContext
from app.market.cache import PriceCache
from app.market.history import period_rows, summarize
from app.state import DemoState
from app.trades import portfolio


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
        spec("prepare_buy",
             "Set up a purchase on the app's buy screens: opens the asset, types the amount, "
             "picks the wallet and opens the review screen. Stops there. It does NOT buy: "
             "the user checks the fee and total and taps Confirm purchase. Always call this for a "
             "buy request, even if the amount looks wrong: it checks the minimum.",
             {"asset_id": asset, "amount_thb": {"type": "number"},
              "wallet": {"type": "string", "enum": list(a["wallets"])}}, optional=("wallet",)),
        spec("cancel_buy", "Cancel the purchase that is open on screen. Nothing is bought. "
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


def _data_id(app_asset: str) -> str | None:
    a = knowledge.app_ui()["assets"].get(app_asset)
    if a is None:
        raise ValueError(f"unknown asset {app_asset}")
    return a["data_id"]


def _price(ctx: ToolContext, app_asset: str) -> dict:
    data_id = _data_id(app_asset)
    p = ctx.cache.get(data_id) if data_id else None
    if p is None:
        return {"available": False, "note": "no live data for this asset"}
    return {k: p[k] for k in ("price_thb", "change_24h_pct", "as_of", "freshness")}


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
    return _envelope(ctx, "get_history", {"asset_id": asset_id, "period": period, "summary": s},
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
        # The prototype's chart, asset and portfolio numbers are US dollars; its buy numbers are baht.
        live = {"chart": {"asset": (snap.get("asset") or {}).get("name"), "period": snap.get("period"),
                          "currency": "USD", **(snap.get("chart") or {})},
                "asset": {"currency": "USD", **(snap.get("asset") or {})},
                "buy": snap.get("buy") and {"currency": "THB", **snap["buy"]},
                "portfolio": {"currency": "USD", **(snap.get("portfolio") or {})}}[part]
        provider, freshness = "app screen (demo data)", "screen"
    elif not snap:
        app_asset = ctx.ui_state.asset
        if element_id == "asset.chart" and _data_id(app_asset):
            period = (ctx.screen.chart_period if ctx.screen else None) or "1M"
            live = {"asset": app_asset, "period": period,
                    "summary": summarize(period_rows(_data_id(app_asset), period))}
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


def _prepare_buy(state, asset_id, amount_thb, wallet="thb"):
    return ui.prepare_buy(state, asset_id, amount_thb, wallet)


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
    "prepare_buy": _ui_tool(_prepare_buy),
    "cancel_buy": _ui_tool(ui.cancel_buy),
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
