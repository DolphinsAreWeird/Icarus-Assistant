from fastapi.testclient import TestClient

from app.main import create_app


def _health(**kw):
    with TestClient(create_app(offline=True, poll=False, **kw)) as client:
        return client.get("/health"), client.get("/ready")


def test_model_engine_reports_engine_and_offline_preview():
    health, ready = _health(engine="model", model_offline=True)
    body = health.json()
    assert health.status_code == 200
    assert body["engine"] == "model" and body["model_offline"] is True
    assert body["assistant"] == "model/offline-preview"
    assert body["offline"] is True
    assert ready.status_code == 200 and ready.json()["engine"] == "model"


def test_model_engine_gateway_is_not_offline():
    body = _health(engine="model", model_offline=False)[0].json()
    assert body["model_offline"] is False and body["assistant"] == "model/gateway"


def test_legacy_engine_without_model():
    health, ready = _health(engine="legacy")
    body = health.json()
    assert body["engine"] == "legacy" and not body["assistant"].startswith("model")
    assert body["model_offline"] is None  # ICARUS_MODEL_OFFLINE does nothing under legacy
    assert ready.json()["engine"] == "legacy"


def test_ready_is_503_until_prices_load():
    app = create_app(offline=True, poll=False, engine="legacy")
    with TestClient(app) as client:
        app.state.cache.prices.clear()
        body = client.get("/health").json()
        assert body["ready"] is False and body["prices_loaded"] == 0
        response = client.get("/ready")
        assert response.status_code == 503
        assert response.json()["detail"]["reason"] == "prices_not_loaded"
