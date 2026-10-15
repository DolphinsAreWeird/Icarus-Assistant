"""The tools the LLM can call. Every number Icarus says comes from one of these.

Each result is wrapped in an envelope with a result_id and its source, so replies
can cite where each number came from. Asset and element ids are enums in the
schemas, and the code checks them again, since not every model obeys the schema.
"""
import json
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime

from app import knowledge
from app.contracts import ScreenContext
from app.market.cache import PriceCache
from app.market.history import PERIODS, period_rows, summarize
from app.state import DemoState
from app.trades import TradeError, portfolio, prepare_trade


@dataclass
class ToolContext:
    """Everything a tool may touch during one chat turn."""
    state: DemoState
    cache: PriceCache
    user_id: str
    lang: str
    screen: ScreenContext | None
    results: dict = field(default_factory=dict)      # result_id -> envelope
    ui_actions: list = field(default_factory=list)


def tool_specs() -> list[dict]:
    asset_ids = list(knowledge.assets())
    element_ids = list(knowledge.ui_elements())

    def spec(name, description, properties):  # OpenAI function-calling format
        return {"type": "function", "function": {
            "name": name, "description": description,
            "parameters": {"type": "object", "properties": properties,
                           "required": list(properties), "additionalProperties": False}}}

    asset = {"type": "string", "enum": asset_ids}
    return [
        spec("get_prices", "Live price in baht and 24h change for one or more assets.",
             {"asset_ids": {"type": "array", "items": asset}}),
        spec("get_history", "Price over a period: start, end, change, high and low, in baht.",
             {"asset_id": asset, "period": {"type": "string", "enum": list(PERIODS)}}),
        spec("get_asset_info", "What an asset is, its unit, when it can be sold, and the fee rules.",
             {"asset_id": asset}),
        spec("explain_element",
             "Explain a part of the screen: what it shows, the terms on it, and its live numbers "
             "for the asset and chart period the user is looking at.",
             {"element_id": {"type": "string", "enum": element_ids}}),
        spec("get_portfolio", "The user's cash, holdings, value, share of total, and fees this month.",
             {}),
        spec("prepare_trade",
             "Make a buy or sell preview. Does NOT trade: the user must tap Confirm on the card. "
             "amount_thb is the total the user pays (buy) or the value sold (sell), fee included.",
             {"asset_id": asset, "side": {"type": "string", "enum": ["buy", "sell"]},
              "amount_thb": {"type": "number"}}),
        spec("highlight_element", "Highlight a part of the screen with a short message.",
             {"element_id": {"type": "string", "enum": element_ids},
              "message": {"type": "string"}}),
    ]


def _envelope(ctx: ToolContext, tool: str, data: dict, provider: str,
              as_of: str | None = None, freshness: str = "n/a") -> dict:
    env = {"result_id": "r_" + secrets.token_hex(3), "tool": tool, "data": data,
           "source": {"provider": provider, "as_of": as_of, "freshness": freshness}}
    ctx.results[env["result_id"]] = env
    return env


def _price(ctx: ToolContext, asset_id: str) -> dict | None:
    p = ctx.cache.get(asset_id)
    if p is None:
        return None
    return {k: p[k] for k in ("price_thb", "change_24h_pct", "as_of", "freshness")}


def _worst_freshness(values: list[str]) -> str:
    for level in ("offline", "delayed"):
        if level in values:
            return level
    return "live" if values else "n/a"


def get_prices(ctx: ToolContext, asset_ids: list[str]) -> dict:
    data = {a: _price(ctx, a) for a in asset_ids}
    fresh = [p["freshness"] for p in data.values() if p]
    as_of = max((p["as_of"] for p in data.values() if p), default=None)
    return _envelope(ctx, "get_prices", data, "binance + frankfurter", as_of, _worst_freshness(fresh))


def get_history(ctx: ToolContext, asset_id: str, period: str) -> dict:
    s = summarize(period_rows(asset_id, period))
    return _envelope(ctx, "get_history", {"asset_id": asset_id, "period": period, "summary": s},
                     "binance history snapshot", s["end"]["t"] if s else None, "snapshot")


def get_asset_info(ctx: ToolContext, asset_id: str) -> dict:
    a, fees = knowledge.assets()[asset_id], knowledge.fees()
    data = {
        "asset_id": asset_id, "name": a["name"] if ctx.lang == "en" else a["name_th"],
        "description": a["description_en"] if ctx.lang == "en" else a["description_th"],
        "unit": a["unit"], "grams_per_unit": a.get("grams_per_unit"), "sell_hours": a["sell_hours"],
        "trading_fee_pct": fees["trading_fee_pct"], "min_fee_thb": fees["min_fee_thb"],
        "min_buy_thb": fees["min_buy_thb"], "fees_are_mock": fees["mock"],
    }
    return _envelope(ctx, "get_asset_info", data, "assets.json + fees.json (reviewed by us)")


def explain_element(ctx: ToolContext, element_id: str) -> dict:
    element = knowledge.ui_elements()[element_id]
    glossary = knowledge.glossary()
    key = "explain_en" if ctx.lang == "en" else "explain_th"
    terms = [{"term": glossary[t][ctx.lang], "explanation": glossary[t][key]}
             for t in element["terms"]]

    asset_id = ctx.screen.selected_asset if ctx.screen else None
    source = element.get("data") or ""
    live, freshness = None, "n/a"
    if source.startswith("get_prices") and asset_id:
        live = _price(ctx, asset_id)
        freshness = live["freshness"] if live else "n/a"
    elif source == "get_history" and asset_id:
        period = (ctx.screen.chart_period if ctx.screen else None) or "1m"
        live = {"asset_id": asset_id, "period": period,
                "summary": summarize(period_rows(asset_id, period))}
        freshness = "snapshot"
    elif source.startswith("get_portfolio"):
        live = portfolio(ctx.state.users[ctx.user_id], ctx.cache, _now_iso(ctx))
    elif source.startswith("prepare_trade"):
        fees = knowledge.fees()
        live = {k: fees[k] for k in ("trading_fee_pct", "min_fee_thb", "min_buy_thb", "mock")}

    data = {"element_id": element_id, "shows": element["shows"], "terms": terms,
            "selected_asset": asset_id, "live": live}
    ctx.ui_actions.append({"type": "highlight", "element_id": element_id, "message": element["shows"]})
    return _envelope(ctx, "explain_element", data, "ui_elements.json + glossary.json + live data",
                     freshness=freshness)


def get_portfolio(ctx: ToolContext) -> dict:
    data = portfolio(ctx.state.users[ctx.user_id], ctx.cache, _now_iso(ctx))
    return _envelope(ctx, "get_portfolio", data, "demo account", freshness="simulated")


def prepare_trade_tool(ctx: ToolContext, asset_id: str, side: str, amount_thb: float) -> dict:
    try:
        preview = prepare_trade(ctx.state, ctx.cache, ctx.user_id, asset_id, side, amount_thb)
    except TradeError as e:
        return _envelope(ctx, "prepare_trade", {"ok": False, "reason": e.code, **e.details},
                         "demo account", freshness="simulated")
    card = {k: v for k, v in preview.items() if k not in ("user_id", "status", "expires_at")}
    card["expires_in_s"] = knowledge.fees()["preview_expiry_s"]
    env = _envelope(ctx, "prepare_trade", {"ok": True, **card}, "demo account (simulated)",
                    freshness=preview["freshness"])
    # The card is built from the tool result, never from what the model writes.
    ctx.ui_actions.append({"type": "card", "card_type": "trade_preview", "data": card})
    return env


def highlight_element(ctx: ToolContext, element_id: str, message: str) -> dict:
    if element_id not in knowledge.ui_elements():  # backs up the schema's enum
        raise ValueError(f"unknown element {element_id}")
    ctx.ui_actions.append({"type": "highlight", "element_id": element_id, "message": message})
    return {"ok": True}


def _now_iso(ctx: ToolContext) -> str:
    return datetime.fromtimestamp(ctx.state.clock(), UTC).isoformat()


TOOLS = {
    "get_prices": get_prices,
    "get_history": get_history,
    "get_asset_info": get_asset_info,
    "explain_element": explain_element,
    "get_portfolio": get_portfolio,
    "prepare_trade": prepare_trade_tool,
    "highlight_element": highlight_element,
}


def run_tool(ctx: ToolContext, name: str, args: dict) -> str:
    """Run one tool call and return its result as JSON text for the model."""
    if name not in TOOLS:
        raise ValueError(f"unknown tool {name}")
    return json.dumps(TOOLS[name](ctx, **args), ensure_ascii=False)
