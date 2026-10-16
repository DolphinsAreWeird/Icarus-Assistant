from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import threading
import json
from unittest.mock import patch

from fastapi.testclient import TestClient
import pytest

from app.contracts import ChatRequest
from app.main import create_app
from app.model_runtime import SnapshotAdapter
from app.model_service import ModelService, SessionStore, SessionsBusy
from app.model_snapshot import build_snapshot


@pytest.fixture
def app():
    return create_app(offline=True, poll=False, engine="model", model_offline=True)


@pytest.fixture
def client(app):
    with TestClient(app) as client:
        yield client


def ask(client, text, **kwargs):
    return client.post("/chat", json={"text": text, "user_id": "u_small", **kwargs})


def test_default_engine_is_model():
    app = create_app(offline=True, poll=False)
    with TestClient(app) as client:
        assert client.get("/health").json()["engine"] == "model"


def test_real_model_fee_path_and_legacy_envelope(client):
    response = ask(client, "/fee 1000")
    assert response.status_code == 200
    reply = response.json()
    assert reply["status"] == "ok"
    assert reply["debug"]["route"] == "deterministic_fee"
    assert reply["numerical_summaries"]
    assert reply["ui_actions"] == []
    assert reply["speech"] in reply["text"]
    assert reply["speech_exact"] is True
    assert reply["disclaimer"] in reply["text"]


def test_prices_are_server_owned_and_snapshot_labeled(client):
    response = ask(client, "/prices THB btc gold", snapshot={
        "screen": "home", "prices": [{"price": "1", "origin": "market"}],
        "portfolio": {"value_thb": 999999999}})
    reply = response.json()
    assert reply["status"] == "ok"
    evidence = reply["evidence"][0]["data"]["data"]["prices"]
    assert all(p["source"]["delivery"] == "snapshot" for p in evidence)
    assert all(not p["usable_as_live"] for p in evidence)
    assert all(Decimal(p["price"]) > 1 for p in evidence)
    assert all("USDT=USD approximation" in p["source"]["provider"] for p in evidence)
    assert all(p["change_24h_pct"] is None for p in evidence)
    assert reply["numerical_summaries"][0]["text"] in reply["text"]


def test_snapshot_cash_and_position_values(app):
    payload = build_snapshot(app.state.cache, app.state.demo, "u_small")
    account = SnapshotAdapter(payload).get_portfolio()
    assert account["account_ref"] == "u_small"
    assert account["origin"] == "synthetic"
    assert sum(Decimal(p["value"]) for p in account["positions"]) == Decimal(account["total_including_cash"])
    assert next(p["value"] for p in account["positions"] if p["asset"] == "cash") == "1195.00"
    raw = next(p for p in payload["prices"] if p["currency"] == "USDT")
    assert "USD" != raw["currency"]


def test_account_unavailable_if_any_holding_cannot_be_valued(app):
    app.state.demo.users["u_small"]["holdings"]["unsupported"] = {"qty": 1}
    payload = build_snapshot(app.state.cache, app.state.demo, "u_small")
    assert payload["account"] is None
    with pytest.raises(ValueError, match="ACCOUNT_DATA_UNAVAILABLE"):
        SnapshotAdapter(payload).get_portfolio()


def test_fx_age_bounds_converted_price_age(app):
    app.state.cache.fx["as_of"] = "2020-01-01"
    prices = SnapshotAdapter(build_snapshot(app.state.cache, app.state.demo, "u_small")).get_prices(["btc"], "THB")
    row = prices["prices"][0]
    assert row["source"]["observed_at"].startswith("2020-01-01")
    assert row["freshness"] == "delayed"


def test_chart_without_versioned_exact_points_is_unavailable(client):
    reply = ask(client, "/chart", snapshot={"screen": "asset", "asset": {"id": "XAU"},
                "period": "1M", "chart": {"start": 1, "end": 2}}).json()
    assert reply["status"] == "data_unavailable"
    assert reply["evidence"][0]["data"]["data"]["code"] == "DISPLAYED_CHART_UNAVAILABLE"


def test_profile_context_isolated_by_user_and_session(client, app):
    ask(client, "/set goal retirement", session_id="shared")
    ask(client, "/set goal tuition", session_id="other")
    ask(client, "/profile", session_id="shared", user_id="u_new")
    sessions = app.state.assistant.sessions.entries
    assert sessions[("u_small", "shared")].session.updates["goal"] == "retirement"
    assert sessions[("u_small", "other")].session.updates["goal"] == "tuition"
    assert sessions[("u_new", "shared")].session.updates == {}
    assert "profile_provenance" not in ask(client, "/profile", session_id="shared").json()["debug"]


def test_legacy_voice_aliases_and_thai(client):
    response = client.post("/chat", json={"text": "/fee 1000", "userId": "demo-user",
                                          "language": "th", "input_mode": "voice"})
    assert response.status_code == 200
    assert any("\u0e00" <= c <= "\u0e7f" for c in response.json()["text"])


@pytest.mark.parametrize("fields", [
    {"text": " "}, {"text": "x" * 8001}, {"session_id": "../bad"},
    {"user_id": "../bad"}, {"snapshot": {"asset": "BTC"}},
    {"snapshot": {"buy": []}}, {"lang": "xx"},
])
def test_invalid_requests_are_422(client, fields):
    assert client.post("/chat", json={"text": "/fee 1000", **fields}).status_code == 422


def test_unknown_user_is_404(client):
    assert ask(client, "/fee 1000", user_id="unknown").status_code == 404


def test_reset_clears_model_and_demo_state(client, app):
    ask(client, "/set goal retirement")
    assert app.state.assistant.sessions.entries
    assert client.post("/demo/reset").status_code == 200
    assert not app.state.assistant.sessions.entries


def test_capacity_ttl_and_active_session_protection():
    clock = [0]
    store = SessionStore(capacity=1, ttl=10, clock=lambda: clock[0])
    with store.use(("a", "s"), dict):
        clock[0] = 20
        with pytest.raises(SessionsBusy):
            with store.use(("b", "s"), dict):
                pass
        with pytest.raises(SessionsBusy):
            store.reset()
    clock[0] = 31
    with store.use(("b", "s"), dict):
        assert ("a", "s") not in store.entries


def test_concurrent_turns_and_reset_fail_fast(app):
    entered, release = threading.Event(), threading.Event()
    class BlockingSession:
        def __init__(self, **kwargs):
            pass
        def ask(self, *args, **kwargs):
            entered.set()
            assert release.wait(5)
            return {"text": "done"}
    service = ModelService(app.state.demo, app.state.cache, session_factory=BlockingSession)
    req = ChatRequest(text="question", user_id="u_small")
    with ThreadPoolExecutor() as pool:
        task = pool.submit(service.chat, req)
        assert entered.wait(5)
        try:
            with pytest.raises(SessionsBusy):
                service.chat(req)
            with pytest.raises(SessionsBusy):
                service.reset()
        finally:
            release.set()
        assert task.result().text == "done"


def test_failed_turn_rolls_back_profile_and_memory(app):
    class FailingSession:
        def __init__(self, **kwargs):
            self.memory = []
        def ask(self, *args, **kwargs):
            self.memory.append("partial")
            raise RuntimeError("failed")
    service = ModelService(app.state.demo, app.state.cache, session_factory=FailingSession)
    with pytest.raises(RuntimeError):
        service.chat(ChatRequest(text="question", user_id="u_small"))
    entry = service.sessions.entries[("u_small", "default")]
    assert entry.session.memory == []
    assert entry.active == 0


def test_session_saturation_is_structured_http_error(client, app):
    app.state.assistant.sessions = SessionStore(capacity=1)
    assert ask(client, "/fee 1000", session_id="a").status_code == 200
    response = ask(client, "/fee 1000", session_id="b")
    assert response.status_code == 429
    assert response.json()["detail"]["code"] == "sessions_busy"


def test_client_can_only_use_configured_cors_origins(client):
    good = client.options("/chat", headers={"Origin": "http://localhost:8787", "Access-Control-Request-Method": "POST"})
    bad = client.options("/chat", headers={"Origin": "https://untrusted.example", "Access-Control-Request-Method": "POST"})
    assert good.status_code == 200
    assert bad.status_code == 400


def test_gateway_tool_round_trip_uses_adapter_and_refreshes_each_turn(client, app):
    service = app.state.assistant
    service.offline, service.model = False, "scripted-gateway"
    seen = []
    def completion(model, messages, timings, **kwargs):
        assert model == "scripted-gateway"
        tool_messages = [m for m in messages if m["role"] == "tool"]
        if not tool_messages:
            return {"tool_calls": [{"id": "price-call", "type": "function", "function": {
                "name": "get_prices", "arguments": '{"asset_ids":["btc"],"currency":"USDT"}'}}]}
        data = json.loads(tool_messages[-1]["content"])
        seen.append(data["data"])
        return {"content": json.dumps({"text": "This is a saved reference observation.",
                "source_ids": [data["result_id"]], "limitation_codes": ["saved_reference"]})}
    with patch("assistant.completion", side_effect=completion):
        first = ask(client, "What is Bitcoin's reference price in USDT?").json()
        app.state.cache.prices["btc"]["price_usd"] = 12345.67
        second = ask(client, "What is Bitcoin's reference price in USDT?").json()
    assert first["status"] == second["status"] == "ok"
    assert first["debug"]["route"] == "qwen_grounded"
    assert first["debug"]["snapshot_id"] != second["debug"]["snapshot_id"]
    assert seen[0]["prices"][0]["price"] != seen[1]["prices"][0]["price"]
    assert seen[1]["prices"][0]["price"] == "12345.67"
    assert second["numerical_summaries"][0]["text"] in second["text"]


def test_failed_gateway_answer_keeps_verified_evidence(client, app):
    app.state.assistant.offline, app.state.assistant.model = False, "scripted-gateway"
    def completion(model, messages, timings, **kwargs):
        if any(m["role"] == "tool" for m in messages):
            return {"content": '{"text":"Invented price 999999","source_ids":[],"limitation_codes":[]}'}
        return {"tool_calls": [{"id": "price-call", "function": {"name": "get_prices",
                "arguments": '{"asset_ids":["btc"],"currency":"USDT"}'}}]}
    with patch("assistant.completion", side_effect=completion):
        reply = ask(client, "What is Bitcoin's reference price in USDT?").json()
    assert reply["status"] == "needs_review"
    assert "Invented price" not in reply["text"]
    assert reply["evidence"] and reply["numerical_summaries"]
    assert reply["ui_actions"] == []
