"""HTTP API. Run from backend/:  .venv/bin/uvicorn app.main:app --port 8000"""
import threading
import time
from contextlib import asynccontextmanager
from datetime import UTC, datetime

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app import knowledge
from app.assistant.llm import ChatModel, LLMError, RateLimited
from app.assistant.loop import Assistant, UnknownUser
from app.config import OFFLINE, POLL_INTERVAL_S
from app.contracts import ChatReply, ChatRequest, ConfirmRequest, ErrorBody
from app.market.cache import PriceCache
from app.market.history import PERIODS, period_rows
from app.state import DemoState
from app.trades import TradeError, confirm_trade, portfolio

ERRORS = {
    "unknown_user": ("We don't know that user.", "ไม่พบผู้ใช้นี้"),
    "unknown_asset": ("That asset isn't in the app.", "ไม่มีสินทรัพย์นี้ในแอป"),
    "no_model": ("The assistant isn't set up yet.", "ผู้ช่วยยังไม่พร้อมใช้งาน"),
    "rate_limited": ("Icarus is busy. Try again in a minute.", "Icarus ยุ่งอยู่ ลองใหม่อีกนาทีนะ"),
    "assistant_failed": ("Icarus couldn't answer just now. Try again.", "Icarus ตอบไม่ได้ตอนนี้ ลองอีกครั้งนะ"),
    "preview_not_found": ("That preview doesn't exist.", "ไม่พบรายการนี้"),
    "preview_expired": ("That preview expired. Ask again for a fresh price.", "รายการนี้หมดเวลาแล้ว ขอราคาใหม่อีกครั้งนะ"),
    "not_enough_cash": ("Not enough baht in your balance.", "ยอดเงินไม่พอ"),
    "not_enough_holdings": ("You don't hold enough of that.", "คุณถือไม่พอ"),
}


def fail(status: int, code: str, **details):
    en, th = ERRORS.get(code, (code, code))
    body = ErrorBody(code=code, message_en=en, message_th=th).model_dump()
    raise HTTPException(status, detail={**body, **details})


def make_llm():
    try:
        return ChatModel.from_env()
    except LLMError:
        return None


def create_app(llm=None, offline: bool = OFFLINE, poll: bool = True) -> FastAPI:
    cache = PriceCache(knowledge.assets(), offline=offline)
    state = DemoState()
    llm = llm if llm is not None else make_llm()
    assistant = Assistant(llm, state, cache) if llm else None

    def poller():
        while True:
            cache.refresh()
            time.sleep(POLL_INTERVAL_S)

    @asynccontextmanager
    async def lifespan(app):
        if poll and not offline:
            threading.Thread(target=poller, daemon=True).start()
        yield

    app = FastAPI(title="Icarus backend", lifespan=lifespan)
    app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
    app.state.cache, app.state.demo = cache, state

    @app.get("/health")
    def health():
        return {"offline": offline, "assistant": f"{llm.provider}/{llm.model}" if llm else "not set up",
                "fx": cache.fx,
                "prices": {k: v["freshness"] for k, v in cache.get_all().items()}}

    @app.get("/prices")
    def prices(ids: str | None = Query(None, description="comma separated, e.g. btc,gold")):
        wanted = ids.split(",") if ids else list(knowledge.assets())
        return {a: cache.get(a) for a in wanted if cache.get(a)}

    @app.get("/history/{asset_id}")
    def history(asset_id: str, period: str = "1m"):
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
            return assistant.chat(req)
        except UnknownUser:
            fail(404, "unknown_user")
        except RateLimited:
            fail(429, "rate_limited")
        except Exception as e:
            fail(502, "assistant_failed", reason=type(e).__name__)

    @app.post("/trades/{preview_id}/confirm")
    def confirm(preview_id: str, body: ConfirmRequest):
        try:
            return confirm_trade(state, body.user_id, preview_id)
        except TradeError as e:
            fail(404 if e.code == "preview_not_found" else 409, e.code, **e.details)

    @app.post("/demo/reset")
    def reset():
        state.reset()
        return {"ok": True, "users": list(state.users)}

    return app


app = create_app()
