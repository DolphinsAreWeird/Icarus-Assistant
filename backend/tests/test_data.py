from datetime import date

import pytest

from app import knowledge
from app.fees import buy_quantity, sell_proceeds, trade_fee
from scripts.make_users import build_user

FEES = {"trading_fee_pct": 0.25, "min_fee_thb": 5}


# ---------- fees ----------

def test_fee_percent_and_minimum():
    assert trade_fee(10_000, FEES) == 25.0
    assert trade_fee(1_000, FEES) == 5.0  # 2.50 is below the minimum


def test_buy_quantity_takes_fee_from_amount():
    qty, fee = buy_quantity(1_000, 100_000, FEES)
    assert fee == 5.0
    assert qty == pytest.approx(995 / 100_000)


def test_sell_proceeds():
    assert sell_proceeds(4_000, FEES) == (3_990.0, 10.0)


# ---------- knowledge files ----------

def test_knowledge_files_are_consistent():
    problems = knowledge.validate_knowledge(knowledge.assets(), knowledge.glossary(),
                                            knowledge.ui_elements(), knowledge.journey())
    assert problems == []


def test_validator_catches_unknown_highlight():
    journey = {"stages": ["deposited"],
               "next_step": {"deposited": {"highlight": "nope.button"}}}
    problems = knowledge.validate_knowledge({}, {}, {}, journey)
    assert problems == ["journey stage deposited: unknown element 'nope.button'"]


# ---------- seed users ----------

HISTORY = {
    "btc": [{"t": "2026-10-01T00:00:00+00:00", "close_thb": 100_000.0},
            {"t": "2026-10-10T00:00:00+00:00", "close_thb": 120_000.0}],
}


def test_build_user_books_cash_fees_and_cost():
    plan = [(14, "deposit", None, 5_000),   # 2026-10-01
            (13, "buy", "btc", 4_000),      # uses the 10-01 close
            (5, "sell", "btc", 1_200)]      # uses the 10-10 close
    user = build_user("u_t", "Test", plan, date(2026, 10, 15), HISTORY, FEES)

    buy, sell = user["transactions"][1], user["transactions"][2]
    assert buy["price_thb"] == 100_000.0 and buy["fee_thb"] == 10.0
    assert sell["price_thb"] == 120_000.0 and sell["fee_thb"] == 5.0
    assert user["cash_thb"] == 5_000 - 4_000 + 1_195
    assert user["holdings"]["btc"]["qty"] == pytest.approx(3_990 / 100_000 - 1_200 / 120_000)
    assert user["journey"]["stage"] == "first_purchase"


def test_build_user_refuses_overspending():
    with pytest.raises(ValueError):
        build_user("u_t", "Test", [(14, "buy", "btc", 100)], date(2026, 10, 15), HISTORY, FEES)


def test_env_file_fills_missing_settings_but_never_overrides(tmp_path, monkeypatch):
    from app.config import load_env_file
    env = tmp_path / ".env"
    env.write_text('# comment\nICARUS_T_A="from file"\nICARUS_T_B=from file\nICARUS_T_EMPTY=\n')
    monkeypatch.setenv("ICARUS_T_B", "real env")
    monkeypatch.delenv("ICARUS_T_A", raising=False)
    monkeypatch.delenv("ICARUS_T_EMPTY", raising=False)
    load_env_file(env)
    import os
    assert os.environ["ICARUS_T_A"] == "from file"
    assert os.environ["ICARUS_T_B"] == "real env"
    assert "ICARUS_T_EMPTY" not in os.environ
    monkeypatch.delenv("ICARUS_T_A")
