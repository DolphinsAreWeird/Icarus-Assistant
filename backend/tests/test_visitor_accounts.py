"""Each visitor of the hosted demo gets their own copy of a demo user, so judges never share a balance."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.state import MAX_VISITORS, DemoState


def test_a_visitor_gets_a_fresh_copy_of_the_demo_user():
    state = DemoState()
    visitor = state.users["u_new-k3j9x2ab7q"]
    assert visitor["user_id"] == "u_new-k3j9x2ab7q"
    assert visitor["cash_thb"] == state.users["u_new"]["cash_thb"]
    visitor["cash_thb"] -= 1000
    assert state.users["u_new"]["cash_thb"] != visitor["cash_thb"]
    assert state.users.get("u_new-k3j9x2ab7q") is visitor  # the same account on the next request


@pytest.mark.parametrize("user_id", ["u_nobody-k3j9x2ab", "u_new-", "u_new-ab", "u_new-ABCDEFGH", "u_new-k3j9x2ab/../x", "", None])
def test_only_well_formed_visitor_ids_of_known_users_get_an_account(user_id):
    state = DemoState()
    assert user_id not in state.users
    assert state.users.get(user_id) is None


def test_the_oldest_visitors_go_first_when_there_are_too_many():
    state = DemoState()
    ids = [f"u_new-v{n:07d}" for n in range(MAX_VISITORS + 3)]
    for i in ids:
        assert i in state.users
    assert dict.__contains__(state.users, ids[-1])
    assert not dict.__contains__(state.users, ids[0])
    assert "u_new" in state.users and "u_small" in state.users  # seed users are never dropped


def test_a_purchase_by_one_visitor_leaves_another_visitors_account_alone():
    with TestClient(create_app(offline=True, poll=False, model_offline=True)) as client:
        before = client.get("/demo/state/u_new-judgetwo1").json()
        preview = client.post("/trades/preview", json={"user_id": "u_new-judgeone1", "asset_id": "gold",
                                                       "side": "buy", "amount_thb": 1000})
        assert preview.status_code == 200, preview.text
        confirmed = client.post(f"/trades/{preview.json()['preview_id']}/confirm", json={"user_id": "u_new-judgeone1"})
        assert confirmed.status_code == 200, confirmed.text
        assert client.get("/demo/state/u_new-judgetwo1").json() == before
        assert client.get("/demo/state/u_new-judgeone1").json() != before
