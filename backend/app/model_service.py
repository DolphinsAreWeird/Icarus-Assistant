"""Bounded, per-account conversation sessions around the model Python interface."""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import os
import threading
import time
import re

from app.assistant.checks import detect_language
from app.assistant.guard import guard_text
from app.assistant.loop import UnknownUser
from app.contracts import ChatReply, SourceRef
from app.model_runtime import ConversationSession, SnapshotAdapter
from app.model_snapshot import build_snapshot
from app.demo_data import bind_screen, model_screen_context
from app.demo_intents import handle_intent


class SessionsBusy(Exception):
    pass


@dataclass
class Entry:
    session: object
    touched: float
    active: int = 0
    lock: object = field(default_factory=threading.Lock)


class SessionStore:
    def __init__(self, capacity=128, ttl=1800, clock=time.monotonic):
        if capacity < 1 or ttl <= 0:
            raise ValueError("INVALID_SESSION_LIMITS")
        self.capacity, self.ttl, self.clock = capacity, ttl, clock
        self.entries = {}
        self.lock = threading.Lock()

    @contextmanager
    def use(self, key, factory):
        with self.lock:
            now = self.clock()
            self.entries = {k: e for k, e in self.entries.items()
                            if e.active or now - e.touched < self.ttl}
            entry = self.entries.get(key)
            if entry is None:
                if len(self.entries) >= self.capacity:
                    raise SessionsBusy()
                entry = self.entries[key] = Entry(factory(), now)
            # Limit queued turns too; fail immediately when this conversation is busy.
            if entry.active:
                raise SessionsBusy()
            entry.active += 1
        try:
            with entry.lock:
                yield entry.session
        finally:
            with self.lock:
                entry.active -= 1
                entry.touched = self.clock()

    def reset(self):
        with self.lock:
            if any(e.active for e in self.entries.values()):
                raise SessionsBusy()
            self.entries.clear()


def reply_envelope(result, snapshot_id, input_mode="text"):
    summaries = result.get("numerical_summaries", [])
    limitations = result.get("limitations", [])
    disclaimer = result.get("disclaimer", "")
    # Old frontend/voice clients render only text; keep evidence-derived figures visible.
    parts = [result["text"], *(s["text"] for s in summaries), *limitations, disclaimer]
    text = "\n\n".join(dict.fromkeys(p for p in parts if p))
    sources = []
    for row in result.get("sources", []):
        record = row["data"]
        data = record.get("data", {})
        provenance = [data["source"]] if isinstance(data.get("source"), dict) else []
        provenance += [p["source"] for p in data.get("prices", [])]
        freshness = data.get("freshness", "n/a")
        price_ages = [p.get("freshness", "n/a") for p in data.get("prices", [])]
        if price_ages:
            freshness = "delayed" if "delayed" in price_ages else price_ages[0]
        if any(p["delivery"] == "snapshot" for p in provenance):
            freshness = "snapshot"
        sources.append(SourceRef(result_id=row["id"], tool=record.get("tool", "knowledge"),
                                 provider="; ".join(dict.fromkeys(p["provider"] for p in provenance)) or "model knowledge",
                                 as_of=min((p["observed_at"] for p in provenance), default=None),
                                 freshness=freshness))
    spoken = summaries[0]["text"] if summaries else result["text"]
    th = result.get("language") == "th"
    for record in result.get("sources", []):
        tool = record["data"].get("tool")
        data = record["data"].get("data", {})
        if data.get("status") in ("error", "unavailable"):
            continue
        if tool == "explain_displayed_chart":
            spoken = (f"กราฟที่แสดงเปลี่ยนจาก {data['first_displayed_price']} เป็น {data['last_displayed_price']} {data['currency']} เปลี่ยนแปลง {data['displayed_change_pct']} เปอร์เซ็นต์ เป็นข้อมูลย้อนหลังที่บันทึกไว้" if th else
                      f"The displayed chart goes from {data['first_displayed_price']} to {data['last_displayed_price']} {data['currency']}, a change of {data['displayed_change_pct']} percent. These are saved historical observations.")
            for summary in summaries:
                if summary.get("source_id") == record["id"]:
                    clean = spoken + f" ({data['start'][:10]} – {data['end'][:10]})"
                    text = text.replace(summary["text"], clean)
                    summary["text"] = clean
            break
        if tool == "get_portfolio" and "total_including_cash" in data:
            spoken = (f"พอร์ตจำลองรวมเงินสดมีมูลค่า {data['total_including_cash']} {data['currency']} ตรวจสอบรายละเอียดบนหน้าจอ" if th else
                      f"Your simulated portfolio, including cash, is valued at {data['total_including_cash']} {data['currency']}. Check the breakdown on screen.")
            break
        if tool == "get_prices" and data.get("prices"):
            p = data["prices"][0]
            spoken = (f"ราคาอ้างอิง {p['asset_id']} คือ {p['price']} {p['currency']} ตรวจสอบเวลาของข้อมูลบนหน้าจอ ไม่ใช่ราคาเสนอซื้อขาย" if th else
                      f"The reference price for {p['asset_id']} is {p['price']} {p['currency']}. Check the observation time on screen; this is not an executable quote.")
            break
    lang = "th" if th else "en"
    text, broke_rule = guard_text(text, lang)  # advice or "it's bought" never reaches the user, whatever the model wrote
    if broke_rule:
        spoken = text
    return ChatReply(text=text, speech=spoken, speech_exact=bool(summaries) and not broke_rule, speak=input_mode == "voice", ui_actions=[], sources=sources,
                     status=result.get("status", "ok"), limitations=limitations, disclaimer=disclaimer,
                     numerical_summaries=summaries, evidence=result.get("sources", []),
                     debug={"engine": "model", "route": result.get("route"), "snapshot_id": snapshot_id,
                            "elapsed_seconds": result.get("elapsed_seconds", 0), "guard": broke_rule})


class ModelService:
    def __init__(self, state, cache, *, offline=True, model=None, sessions=None,
                 session_factory=ConversationSession):
        self.state, self.cache = state, cache
        self.offline, self.model = offline, model
        self.sessions = sessions if sessions is not None else SessionStore()
        self.session_factory = session_factory
        self.lifecycle_lock = threading.Lock()

    def chat(self, req):
        user_id = os.getenv("DEMO_USER", "u_new") if req.user_id == "demo-user" else req.user_id
        if user_id not in self.state.users:
            raise UnknownUser(user_id)
        language = req.lang or detect_language(req.text)
        today = datetime.now(timezone(timedelta(hours=7))).date().isoformat()
        # Reserve the session before reset can clear it.
        with self.lifecycle_lock:
            reservation = self.sessions.use((user_id, req.session_id),
                                            lambda: self.session_factory(profile_id="new", language=language, today=today))
            session = reservation.__enter__()
        try:
            previous = deepcopy(session.__dict__)
            try:
                session.language = language
                # Luka's session keeps the date behind set_calculation_date (today is read-only there).
                if hasattr(session, "set_calculation_date"):
                    session.set_calculation_date(today)
                else:
                    session.today = today
                intent_reply = handle_intent(req, self.state, self.cache, user_id, language)
                if intent_reply is not None:
                    return intent_reply
                payload = build_snapshot(self.cache, self.state, user_id)
                bind_screen(payload, req.screen_context)
                adapter = SnapshotAdapter(payload)
                context = model_screen_context(req.screen_context)
                message = req.text
                chart_question = message.strip().lower().rstrip("?.! ")
                if (re.fullmatch(r"what does (?:this )?(?:(?:gold|bitcoin|ethereum|pax gold) )?chart mean", chart_question)
                    or chart_question in ("explain this chart", "อธิบายกราฟนี้", "กราฟนี้หมายความว่าอะไร")):
                    message = "/chart"
                if message.strip().lower().rstrip("?.! ") in ("what is in my portfolio", "show my portfolio", "explain my portfolio", "my portfolio", "พอร์ตของฉัน"):
                    message = "/portfolio"
                result = session.ask(message, offline=self.offline, model=self.model,
                                     data_adapter=adapter, screen_context=context)
                return reply_envelope(result, payload["snapshot_id"], req.input_mode)
            except Exception:
                session.__dict__.clear()
                session.__dict__.update(previous)
                raise
        finally:
            reservation.__exit__(None, None, None)

    def reset(self):
        with self.lifecycle_lock:
            self.sessions.reset()
            self.state.reset()
