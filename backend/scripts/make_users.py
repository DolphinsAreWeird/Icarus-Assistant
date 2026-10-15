"""Generate the two synthetic demo users from real price history.

Run from backend/ after `python -m scripts.fetch_market --history`:
  python -m scripts.make_users [--anchor 2026-10-15]

Every trade uses that day's real closing price in baht, so gains and losses are
real. Simplification: trades are stamped at noon Bangkok time but use the day's close.
Writes data/seed/u_new.json and data/seed/u_small.json.
"""
import argparse
import json
from datetime import date, datetime, timedelta

from app import knowledge
from app.config import SEED_DIR
from app.fees import buy_quantity, sell_proceeds
from app.market.history import load_history

# (days before anchor, kind, asset, amount in THB)
U_SMALL_PLAN = [
    (95, "deposit", None, 30_000),
    (94, "buy", "btc", 8_000),
    (80, "buy", "btc", 5_000),
    (72, "buy", "eth", 3_000),
    (60, "buy", "gold", 2_500),
    (52, "buy", "btc", 4_000),
    (45, "deposit", None, 5_200),
    (44, "buy", "btc", 6_000),
    (30, "sell", "eth", 1_000),
    (20, "buy", "btc", 3_000),
    (12, "buy", "gold", 1_000),
    (8, "buy", "btc", 2_000),
    (3, "buy", "eth", 500),
]

U_NEW_PLAN = [
    (2, "deposit", None, 5_000),
]


def close_thb(rows: list[dict], day: str) -> float:
    """That day's closing price, or the last close before it."""
    before = [r for r in rows if r["t"][:10] <= day]
    if not before:
        raise ValueError(f"no price history on or before {day}")
    return before[-1]["close_thb"]


def stamp(day: date) -> str:
    return f"{day.isoformat()}T05:00:00+00:00"  # noon in Bangkok


def build_user(user_id: str, display_name: str, plan: list, anchor: date,
               history: dict, fees: dict) -> dict:
    cash = 0.0
    holdings: dict[str, dict] = {}
    txs = []
    first_deposit = first_buy = None

    for n, (days_ago, kind, asset_id, amount) in enumerate(plan, start=1):
        day = anchor - timedelta(days=days_ago)
        tx = {"id": f"tx_{user_id}_{n:03d}", "ts": stamp(day), "type": kind,
              "asset_id": asset_id, "amount_thb": float(amount)}

        if kind == "deposit":
            cash += amount
            tx.update(price_thb=None, qty=None, fee_thb=0.0)
            first_deposit = first_deposit or day

        elif kind == "buy":
            if amount > cash:
                raise ValueError(f"{tx['id']}: not enough cash")
            price = close_thb(history[asset_id], day.isoformat())
            qty, fee = buy_quantity(amount, price, fees)
            cash -= amount
            h = holdings.setdefault(asset_id, {"qty": 0.0, "cost_thb": 0.0})
            h["qty"] += qty
            h["cost_thb"] += amount  # cost includes the fee
            tx.update(price_thb=price, qty=round(qty, 8), fee_thb=fee)
            first_buy = first_buy or day

        elif kind == "sell":
            price = close_thb(history[asset_id], day.isoformat())
            qty = amount / price
            h = holdings[asset_id]
            if qty > h["qty"]:
                raise ValueError(f"{tx['id']}: selling more {asset_id} than held")
            received, fee = sell_proceeds(amount, fees)
            h["cost_thb"] -= h["cost_thb"] * qty / h["qty"]
            h["qty"] -= qty
            cash += received
            tx.update(price_thb=price, qty=round(qty, 8), fee_thb=fee)

        txs.append(tx)

    signed_up = anchor - timedelta(days=plan[0][0] + 1)
    journey = {
        "stage": "first_purchase" if first_buy else "deposited",
        "signed_up_at": stamp(signed_up),
        "verified_at": stamp(signed_up),
        "deposited_at": stamp(first_deposit) if first_deposit else None,
        "first_purchase_at": stamp(first_buy) if first_buy else None,
    }
    return {
        "user_id": user_id,
        "display_name": display_name,
        "synthetic": True,
        "journey": journey,
        "cash_thb": round(cash, 2),
        "holdings": {k: {"qty": round(v["qty"], 8), "cost_thb": round(v["cost_thb"], 2)}
                     for k, v in holdings.items()},
        "transactions": txs,
    }


def summarize(user: dict, history: dict, anchor: date) -> None:
    month = anchor.isoformat()[:7]
    values = {a: h["qty"] * history[a][-1]["close_thb"] for a, h in user["holdings"].items()}
    total = sum(values.values()) + user["cash_thb"]
    fees_month = sum(t["fee_thb"] for t in user["transactions"] if t["ts"][:7] == month)
    print(f"{user['user_id']}: stage {user['journey']['stage']}, cash {user['cash_thb']:,.2f}, "
          f"total about {total:,.0f} THB, fees this month {fees_month:.2f} THB")
    for asset_id, value in sorted(values.items(), key=lambda kv: -kv[1]):
        print(f"  {asset_id:5} {value:>10,.0f} THB  {value / total * 100:5.1f}%")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--anchor", type=date.fromisoformat, default=datetime.now().date(),
                        help="the demo's 'today' (default: today)")
    args = parser.parse_args()

    fees = knowledge.fees()
    history = {asset_id: load_history(asset_id, "1d") for asset_id in knowledge.assets()}
    users = [
        build_user("u_new", "Mint", U_NEW_PLAN, args.anchor, history, fees),
        build_user("u_small", "Beam", U_SMALL_PLAN, args.anchor, history, fees),
    ]
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    for user in users:
        path = SEED_DIR / f"{user['user_id']}.json"
        path.write_text(json.dumps(user, indent=2, ensure_ascii=False))
        summarize(user, history, args.anchor)


if __name__ == "__main__":
    main()
