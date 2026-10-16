"""HTTP API. Run from backend/:  .venv/bin/uvicorn app.main:app --port 8000"""
import threading
import os
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app import friction, knowledge, nudge, ui
from app.assistant.llm import ChatModel, LLMError, RateLimited
from app.assistant.loop import Assistant, NoModel, UnknownUser
from app.assistant.memo import QuestionLog
from app.config import OFFLINE, POLL_INTERVAL_S
from app.contracts import ChatReply, ChatRequest, ConfirmRequest, ErrorBody, EventRequest, NudgeRequest, PreviewRequest
from app.market.cache import PriceCache
from app.market.history import PERIODS, period_rows, summarize
from app.state import DemoState
from app.trades import TradeError, confirm_trade, portfolio, prepare_trade
from app.demo_data import demo_bundle
from app.model_service import ModelService, SessionsBusy

ERRORS = {
    "unknown_user": ("We don't know that user.", "ไม่พบผู้ใช้นี้"),
    "unknown_asset": ("That asset isn't in the app.", "ไม่มีสินทรัพย์นี้ในแอป"),
    "no_model": ("The assistant isn't set up yet.", "ผู้ช่วยยังไม่พร้อมใช้งาน"),
    "rate_limited": ("Icarus is busy. Try again in a minute.", "Icarus ยุ่งอยู่ ลองใหม่อีกนาทีนะ"),
    "assistant_failed": ("Icarus couldn't answer just now. Try again.", "Icarus ตอบไม่ได้ตอนนี้ ลองอีกครั้งนะ"),
    "sessions_busy": ("This conversation or service is busy. Try again shortly.", "บทสนทนาหรือบริการกำลังใช้งานอยู่ โปรดลองอีกครั้งสักครู่"),
    "bad_amount": ("Enter a supported positive amount with at most two decimal places.", "โปรดระบุจำนวนเงินที่รองรับเป็นบวกและมีทศนิยมไม่เกินสองตำแหน่ง"),
    "below_minimum": ("The minimum demo purchase budget is 100 baht.", "งบซื้อจำลองขั้นต่ำคือ 100 บาท"),
    "no_price": ("No reference price is available for that asset.", "ยังไม่มีราคาอ้างอิงของสินทรัพย์นี้"),
    "preview_not_found": ("That preview doesn't exist.", "ไม่พบรายการนี้"),
    "preview_expired": ("That preview expired. Ask again for a fresh price.", "รายการนี้หมดเวลาแล้ว ขอราคาใหม่อีกครั้งนะ"),
    "preview_cancelled": ("That preview was cancelled. Nothing was bought.", "รายการนี้ถูกยกเลิกแล้ว ไม่มีการซื้อ"),
    "not_enough_cash": ("Not enough baht in your balance.", "ยอดเงินไม่พอ"),
    "not_enough_holdings": ("You don't hold enough of that.", "คุณถือไม่พอ"),
}


def resolve_user(user_id: str) -> str:
    """The voice server's default "demo-user" is the demo account."""
    return os.getenv("DEMO_USER", "u_new") if user_id == "demo-user" else user_id


def fail(status: int, code: str, **details):
    en, th = ERRORS.get(code, (code, code))
    body = ErrorBody(code=code, message_en=en, message_th=th).model_dump()
    raise HTTPException(status, detail={**body, **details})


def make_llm():
    try:
        return ChatModel.from_env()
    except LLMError:
        return None


def create_app(llm=None, offline: bool = OFFLINE, poll: bool = True, *,
               engine: str | None = None, model_offline: bool | None = None) -> FastAPI:
    cache = PriceCache(knowledge.assets(), offline=offline)
    state = DemoState()
    engine = engine or ("legacy" if llm is not None else os.getenv("ASSISTANT_ENGINE", "model"))
    if engine not in ("model", "legacy"):
        raise ValueError("ASSISTANT_ENGINE must be model or legacy")
    model_offline = model_offline if model_offline is not None else os.getenv("ICARUS_MODEL_OFFLINE", "1") == "1"
    if engine == "model":
        assistant = ModelService(state, cache, offline=model_offline, model=os.getenv("ICARUS_LLM_MODEL"))
    else:
        llm = llm if llm is not None else make_llm()
        # Without a model the prepared answers and the fast path still work; the rest says "no_model".
        assistant = Assistant(llm, state, cache, log=QuestionLog.from_env())
    stop_polling = threading.Event()
    first_poll = threading.Event()

    def poller():
        while not stop_polling.is_set():
            try:
                cache.refresh()
                if isinstance(assistant, Assistant):
                    assistant.prices_changed()  # the fact packs follow the prices
            except Exception:
                # Keep the last good bundle; one source failure must not kill polling.
                import logging
                logging.getLogger(__name__).exception("Market refresh failed")
            first_poll.set()
            stop_polling.wait(POLL_INTERVAL_S)

    def prewarm():
        """After the first prices, answer the prepared questions once, so the first visitor isn't slower."""
        first_poll.wait(timeout=20)
        started = time.perf_counter()
        answered = assistant.prewarm()
        print(f"[prewarm] {answered} prepared questions answered in {time.perf_counter() - started:.2f} s, "
              "no model calls", flush=True)

    @asynccontextmanager
    async def lifespan(app):
        stop_polling.clear()
        thread = None
        if poll and not offline:
            thread = threading.Thread(target=poller, daemon=True)
            thread.start()
        else:
            first_poll.set()
        if poll and isinstance(assistant, Assistant):
            threading.Thread(target=prewarm, daemon=True).start()
        try:
            yield
        finally:
            stop_polling.set()
            if thread:
                thread.join(timeout=30)

    app = FastAPI(title="Icarus backend", lifespan=lifespan)
    friction_log = friction.FrictionLog()  # what users ask and where they get stuck (the business's friction map)

    @app.exception_handler(RequestValidationError)
    async def bad_request(_: Request, exc: RequestValidationError):
        """Bad input gets the same error shape as every other error: {code, message_en, message_th}."""
        body = ErrorBody(code="bad_request", message_en="That request wasn't valid.", message_th="คำขอนี้ไม่ถูกต้อง").model_dump()
        fields = [{"field": ".".join(str(x) for x in e["loc"][1:]), "problem": e["msg"]} for e in exc.errors()[:5]]
        return JSONResponse(status_code=422, content={"detail": {**body, "fields": fields}})
    origins = os.getenv("CORS_ORIGINS", "http://localhost:8787,http://127.0.0.1:8787,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000,http://127.0.0.1:3000")
    app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in origins.split(",") if o.strip()],
                       allow_methods=["GET", "POST"], allow_headers=["Content-Type"])
    app.state.cache, app.state.demo = cache, state
    app.state.assistant = assistant

    reported_offline = model_offline if engine == "model" else None  # meaningless under legacy: say so

    def readiness():
        """Cheap: the first price pass has finished and the cache holds at least one price."""
        loaded = len(cache.prices)
        ready = first_poll.is_set() and loaded > 0
        return ready, loaded

    @app.get("/ready")
    def ready():
        """200 only when this backend can answer: started, prices loaded. 503 with the reason otherwise."""
        ok, loaded = readiness()
        body = {"ready": ok, "engine": engine, "model_offline": reported_offline, "offline": offline,
                "prices_loaded": loaded}
        if not ok:
            raise HTTPException(503, detail={**body, "reason": "prices_not_loaded"})
        return body

    @app.get("/health")
    def health():
        ok, loaded = readiness()
        return {"offline": offline, "engine": engine, "model_offline": reported_offline,
                "ready": ok, "prices_loaded": loaded,
                "assistant": ("model/offline-preview" if model_offline else "model/gateway") if engine == "model"
                             else f"{llm.provider}/{llm.model}" if llm else "not set up",
                "llm_cooling": llm.cooling() if engine == "legacy" and hasattr(llm, "cooling") else {},
                "fx": cache.fx,
                "prices": {k: v["freshness"] for k, v in cache.get_all().items()}}

    @app.get("/prices")
    def prices(ids: str | None = Query(None, description="comma separated, e.g. btc,gold")):
        wanted = ids.split(",") if ids else list(knowledge.assets())
        return {a: cache.get(a) for a in wanted if cache.get(a)}

    @app.get("/market")
    def market():
        """For the app's screens, so they show the same baht numbers Icarus says.
        Keyed by the app's asset ids. Assets we have no data for are left out."""
        out = {}
        for app_id, a in knowledge.app_ui()["assets"].items():
            price = cache.get(a["data_id"]) if a["data_id"] else None
            if price is None:
                continue
            changes = {"1D": price["change_24h_pct"]}
            for p in PERIODS:
                s = summarize(period_rows(a["data_id"], p)) if p != "1D" else None
                if s:
                    changes[p] = s["change_pct"]
            out[app_id] = {"price_thb": price["price_thb"], "change_pct": changes,
                           "freshness": price["freshness"], "as_of": price["as_of"]}
        return {"currency": "THB", "fx_usd_thb": (cache.fx or {}).get("rate"), "assets": out}

    @app.get("/history/{asset_id}")
    def history(asset_id: str, period: str = "1M"):
        if asset_id not in knowledge.assets() or period not in PERIODS:
            fail(404, "unknown_asset")
        return {"asset_id": asset_id, "period": period, "rows": period_rows(asset_id, period)}

    @app.get("/portfolio/{user_id}")
    def get_portfolio(user_id: str):
        user = state.users.get(user_id) or fail(404, "unknown_user")
        return portfolio(user, cache, datetime.now(UTC).isoformat())

    @app.post("/chat", response_model=ChatReply)
    def chat(req: ChatRequest):
        if assistant is None:
            fail(503, "no_model")
        try:
            reply = assistant.chat(req)
            friction_log.log_chat(req, reply, resolve_user(req.user_id))
            return reply
        except UnknownUser:
            fail(404, "unknown_user")
        except NoModel:
            fail(503, "no_model")
        except RateLimited:
            fail(429, "rate_limited")
        except SessionsBusy:
            fail(429, "sessions_busy")
        except Exception as e:
            fail(502, "assistant_failed", reason=type(e).__name__)

    @app.post("/nudge")
    def get_nudge(req: NudgeRequest):
        """Proactive help for a user who has been idle on a screen. Rule-based: no model, so it answers
        instantly and also works when /chat is down. Returns {"nudge": null} when there is nothing useful to say."""
        user = state.users.get(resolve_user(req.user_id))
        if user is None:
            fail(404, "unknown_user")
        lang = req.lang or ("th" if str(req.snapshot.get("language")) == "th" else "en")
        try:
            hint = nudge.decide(req.snapshot, user["cash_thb"], lang)
        except Exception:  # a proactive hint must never break the screen
            return {"nudge": None}
        if hint:
            friction_log.log("nudge_issued", user_id=resolve_user(req.user_id), screen=ui.state_from_snapshot(req.snapshot).screen,
                             topic=hint["reason"], lang=lang)
        return {"nudge": hint}

    @app.post("/trades/{preview_id}/confirm")
    def confirm(preview_id: str, body: ConfirmRequest):
        try:
            result = confirm_trade(state, resolve_user(body.user_id), preview_id)
            friction_log.log("task_completed", user_id=resolve_user(body.user_id), session_id=preview_id, screen="buy")
            return result
        except TradeError as e:
            friction_log.log("validation_failed", user_id=resolve_user(body.user_id), screen="buy", topic=e.code)
            fail(404 if e.code == "preview_not_found" else 409, e.code, **e.details)

    @app.post("/demo/reset")
    def reset():
        try:
            if isinstance(assistant, ModelService):
                assistant.reset()
            else:
                state.reset()
        except SessionsBusy:
            fail(409, "sessions_busy")
        return {"ok": True, "users": list(state.users)}

    @app.get("/demo/state/{user_id}")
    def demo_state(user_id: str):
        if user_id not in state.users:
            fail(404, "unknown_user")
        return demo_bundle(cache, state, user_id)

    @app.post("/trades/preview")
    def preview(body: PreviewRequest):
        user_id = resolve_user(body.user_id)
        if user_id not in state.users:
            fail(404, "unknown_user")
        try:
            made = prepare_trade(state, cache, user_id, body.asset_id, body.side, body.amount_thb)
            friction_log.log("preview_shown", user_id=user_id, session_id=made["preview_id"], screen="buy", topic=body.asset_id)
            return made
        except TradeError as e:
            friction_log.log("validation_failed", user_id=user_id, screen="buy", topic=e.code)
            fail(409, e.code, **e.details)

    @app.post("/events")
    def add_event(body: EventRequest):
        """The app tells us what only it can see (a screen view, a task started or abandoned, a help tap)."""
        if body.type not in friction.APP_TYPES:
            fail(422, "bad_request", allowed=sorted(friction.APP_TYPES))
        friction_log.log(body.type, user_id=resolve_user(body.user_id), session_id=body.session_id, screen=body.screen,
                         topic=body.topic, lang=body.lang)
        return {"ok": True}

    @app.get("/friction/summary")
    def friction_summary():
        """What users asked and where they got stuck: the business's friction map, with denominators."""
        return friction_log.summary()

    @app.post("/friction/reset")
    def friction_reset():
        friction_log.clear()
        return {"ok": True}

    @app.post("/trades/{preview_id}/cancel")
    def cancel(preview_id: str, body: ConfirmRequest):
        with state.lock:
            item = state.previews.get(preview_id)
            if item is None or item["user_id"] != resolve_user(body.user_id):
                fail(404, "preview_not_found")
            if item["status"] == "pending":
                item["status"] = "cancelled"
            return {"status": item["status"], "preview_id": preview_id}

    return app


app = create_app()
