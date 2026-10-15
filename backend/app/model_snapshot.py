"""Build model Snapshot v1 from server-owned observations, never client money."""
from copy import deepcopy
from datetime import UTC, datetime
from decimal import Decimal, ROUND_HALF_UP
from uuid import uuid4

SUPPORTED = {"btc", "eth", "gold"}


def iso(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC).isoformat()


def oldest(*values):
    return min((iso(v) for v in values), key=datetime.fromisoformat)


def number(value, cents=False):
    result = Decimal(str(value))
    if not result.is_finite():
        raise ValueError("INVALID_BACKEND_NUMBER")
    if cents:
        result = result.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    return format(result, "f")


def build_snapshot(cache, state, user_id):
    # Each component is copied once. No lock is held during model inference.
    prices, fx = cache.freeze()
    with state.lock:
        user = deepcopy(state.users[user_id])
    rows, valuations, observed = [], {}, []
    for asset_id in sorted(SUPPORTED):
        price = prices.get(asset_id)
        if price is None or price.get("source") != "binance":
            continue
        delivery = "snapshot" if price.get("from_snapshot") else "cache"
        provider = "Binance PAXG proxy" if asset_id == "gold" else "Binance"
        source = {"provider": provider, "origin": "market", "delivery": delivery,
                  "observed_at": iso(price["as_of"]),
                  "source_url": "https://data-api.binance.vision/api/v3/ticker/24hr"}
        rows.append({"asset_id": asset_id, "currency": "USDT", "price": number(price["price_usd"]),
                     "change_24h_pct": number(price["change_24h_pct"]), "source": source})
        if fx:
            # Preserve the backend's displayed approximation. Do not call it a USD quote.
            at = oldest(price["as_of"], fx["as_of"])
            converted = {**source, "observed_at": at, "source_url": None,
                         "provider": f"{provider} + {fx['source']}; USDT=USD approximation"}
            rows.append({"asset_id": asset_id, "currency": "THB", "price": number(price["price_thb"]),
                         "change_24h_pct": None, "source": converted})
            valuations[asset_id] = Decimal(str(price["price_thb"]))
            observed.append(at)

    positions = [{"asset_id": "cash", "value": number(user["cash_thb"], cents=True)}]
    complete = True
    for asset_id, holding in user["holdings"].items():
        qty = Decimal(str(holding["qty"]))
        if qty == 0:
            continue
        if asset_id not in valuations or qty < 0:
            complete = False
            break
        positions.append({"asset_id": asset_id, "value": number(qty * valuations[asset_id], cents=True)})
    account = None
    if complete:
        account = {"account_ref": user_id, "currency": "THB", "positions": positions,
                   "source": {"provider": "Icarus fictional demo account; approximate THB valuation",
                              "origin": "synthetic", "delivery": "fixture",
                              "observed_at": oldest(*observed) if observed else datetime.now(UTC).isoformat(),
                              "source_url": None}}
    return {"schema_version": 1, "snapshot_id": "backend_" + uuid4().hex,
            "prices": rows, "account": account, "screen": None}
