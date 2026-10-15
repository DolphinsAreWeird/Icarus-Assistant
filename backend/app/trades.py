"""Trade previews and confirms. Simulated: balances change in memory only.

prepare_trade never changes balances. Only confirm_trade does, and only the
user's tap on the card calls it. The LLM has no path to confirm_trade.
"""
import secrets
import math
from datetime import UTC, datetime

from app import knowledge
from app.fees import buy_quantity, sell_proceeds
from app.market.cache import PriceCache
from app.state import DemoState


class TradeError(Exception):
    def __init__(self, code: str, **details):
        super().__init__(code)
        self.code = code
        self.details = details


def prepare_trade(state: DemoState, cache: PriceCache, user_id: str,
                  asset_id: str, side: str, amount_thb: float) -> dict:
    with state.lock:
        return _prepare_trade(state, cache, user_id, asset_id, side, amount_thb)


def _prepare_trade(state, cache, user_id, asset_id, side, amount_thb):
    fees, assets = knowledge.fees(), knowledge.assets()
    user = state.users[user_id]
    if asset_id not in assets:
        raise TradeError("unknown_asset", asset_id=asset_id)
    if side not in ("buy", "sell") or not math.isfinite(amount_thb) or not 0 < amount_thb <= 1e9:
        raise TradeError("bad_amount", amount_thb=amount_thb)
    if side == "buy" and amount_thb < fees["min_buy_thb"]:
        raise TradeError("below_minimum", min_buy_thb=fees["min_buy_thb"])
    price = cache.get(asset_id)
    if price is None:
        raise TradeError("no_price", asset_id=asset_id)

    asset = assets[asset_id]
    price_thb = price["price_thb"]
    preview = {
        "preview_id": "pv_" + secrets.token_hex(4),
        "user_id": user_id, "asset_id": asset_id, "asset_name": asset["name"],
        "side": side, "amount_thb": amount_thb, "price_thb": price_thb,
        "unit": asset["unit"], "freshness": price["freshness"], "fee_is_mock": fees["mock"],
    }

    if side == "buy":
        if amount_thb > user["cash_thb"]:
            raise TradeError("not_enough_cash", cash_thb=user["cash_thb"])
        qty, fee = buy_quantity(amount_thb, price_thb, fees)
        preview.update(fee_thb=fee, qty=round(qty, 8), you_pay_thb=amount_thb)
    else:
        qty = amount_thb / price_thb
        held = user["holdings"].get(asset_id, {}).get("qty", 0.0)
        if qty > held:
            raise TradeError("not_enough_holdings", held_value_thb=round(held * price_thb, 2))
        received, fee = sell_proceeds(amount_thb, fees)
        if received <= 0:
            raise TradeError("bad_amount")
        preview.update(fee_thb=fee, qty=round(qty, 8), you_get_thb=received)

    if "grams_per_unit" in asset:
        preview["grams"] = round(preview["qty"] * asset["grams_per_unit"], 4)

    preview["expires_at"] = state.clock() + fees["preview_expiry_s"]
    preview["status"] = "pending"
    for previous in state.previews.values():
        if previous["user_id"] == user_id and previous["status"] == "pending":
            previous["status"] = "cancelled"
    state.previews[preview["preview_id"]] = preview
    return preview


def confirm_trade(state: DemoState, user_id: str, preview_id: str) -> dict:
    """Apply a pending preview. Calling it twice returns the first result."""
    with state.lock:
        preview = state.previews.get(preview_id)
        if preview is None or preview["user_id"] != user_id:
            raise TradeError("preview_not_found")
        if preview["status"] == "confirmed":
            return preview["result"]
        if preview["status"] == "cancelled":
            raise TradeError("preview_cancelled")
        if state.clock() > preview["expires_at"]:
            preview["status"] = "expired"
            raise TradeError("preview_expired")

        user = state.users[user_id]
        asset_id, side = preview["asset_id"], preview["side"]
        holding = user["holdings"].setdefault(asset_id, {"qty": 0.0, "cost_thb": 0.0})

        if side == "buy":
            if preview["amount_thb"] > user["cash_thb"]:
                raise TradeError("not_enough_cash", cash_thb=user["cash_thb"])
            user["cash_thb"] = round(user["cash_thb"] - preview["amount_thb"], 2)
            holding["qty"] = round(holding["qty"] + preview["qty"], 8)
            holding["cost_thb"] = round(holding["cost_thb"] + preview["amount_thb"], 2)
        else:
            if preview["qty"] > holding["qty"]:
                raise TradeError("not_enough_holdings")
            holding["cost_thb"] = round(holding["cost_thb"] * (1 - preview["qty"] / holding["qty"]), 2)
            holding["qty"] = round(holding["qty"] - preview["qty"], 8)
            user["cash_thb"] = round(user["cash_thb"] + preview["you_get_thb"], 2)

        now = datetime.fromtimestamp(state.clock(), UTC).isoformat(timespec="seconds")
        tx = {"id": f"tx_{user_id}_{len(user['transactions']) + 1:03d}", "ts": now,
              "type": side, "asset_id": asset_id, "amount_thb": preview["amount_thb"],
              "price_thb": preview["price_thb"], "qty": preview["qty"],
              "fee_thb": preview["fee_thb"]}
        user["transactions"].append(tx)
        if side == "buy" and user["journey"]["stage"] != "first_purchase":
            user["journey"].update(stage="first_purchase", first_purchase_at=now)

        result = {"status": "confirmed", "transaction": tx, "cash_thb": user["cash_thb"],
                  "journey_stage": user["journey"]["stage"]}
        preview.update(status="confirmed", result=result)
        return result


def cancel_pending(state: DemoState, user_id: str) -> int:
    """Cancel the user's open previews, so a late tap on an old card can't buy. Returns how many."""
    with state.lock:
        pending = [p for p in state.previews.values()
                   if p["user_id"] == user_id and p["status"] == "pending"]
        for p in pending:
            p["status"] = "cancelled"
        return len(pending)


def portfolio(user: dict, cache: PriceCache, now_iso: str) -> dict:
    """Cash, holdings at live prices, shares of total, fees paid this month."""
    holdings, total = [], user["cash_thb"]
    for asset_id, h in user["holdings"].items():
        if h["qty"] <= 0:
            continue
        price = cache.get(asset_id)
        value = round(h["qty"] * price["price_thb"], 2) if price else None
        holdings.append({"asset_id": asset_id, "qty": h["qty"], "value_thb": value,
                         "cost_thb": h["cost_thb"],
                         "gain_thb": round(value - h["cost_thb"], 2) if value else None})
        total += value or 0
    for h in holdings:
        h["share_pct"] = round(h["value_thb"] / total * 100, 1) if h["value_thb"] else None
    month = now_iso[:7]
    fees_month = sum(t["fee_thb"] for t in user["transactions"] if t["ts"][:7] == month)
    return {"cash_thb": user["cash_thb"], "total_thb": round(total, 2),
            "holdings": sorted(holdings, key=lambda h: -(h["value_thb"] or 0)),
            "fees_this_month_thb": round(fees_month, 2),
            "journey_stage": user["journey"]["stage"]}
