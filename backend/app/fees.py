"""Fee and quantity math. Used by the seed generator now and by prepare_trade later,
so the demo history and live trades follow the same rules."""


from decimal import Decimal, ROUND_HALF_UP


def trade_fee(amount_thb: float, fees: dict) -> float:
    """Fee for a buy or sell worth amount_thb: a percent, with a minimum."""
    fee = Decimal(str(amount_thb)) * Decimal(str(fees["trading_fee_pct"])) / 100
    return float(max(fee, Decimal(str(fees["min_fee_thb"]))).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def buy_quantity(amount_thb: float, price_thb: float, fees: dict) -> tuple[float, float]:
    """Spend amount_thb (fee included). Returns (quantity bought, fee)."""
    fee = trade_fee(amount_thb, fees)
    return (amount_thb - fee) / price_thb, fee


def sell_proceeds(amount_thb: float, fees: dict) -> tuple[float, float]:
    """Sell assets worth amount_thb. Returns (baht received after fee, fee)."""
    fee = trade_fee(amount_thb, fees)
    return round(amount_thb - fee, 2), fee
