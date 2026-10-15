"""Bounded, per-account conversation sessions around the model Python interface."""
from contextlib import contextmanager
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import os
import threading
import time

from app.assistant.checks import detect_language
from app.assistant.loop import UnknownUser
from app.contracts import ChatReply, SourceRef
from app.model_runtime import ConversationSession, SnapshotAdapter
from app.model_snapshot import build_snapshot


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


def reply_envelope(result, snapshot_id):
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
    return ChatReply(text=text, speech=text, speak=True, ui_actions=[], sources=sources,
                     status=result.get("status", "ok"), limitations=limitations, disclaimer=disclaimer,
                     numerical_summaries=summaries, evidence=result.get("sources", []),
                     debug={"engine": "model", "route": result.get("route"), "snapshot_id": snapshot_id,
                            "elapsed_seconds": result.get("elapsed_seconds", 0)})


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
                session.language, session.today = language, today
                payload = build_snapshot(self.cache, self.state, user_id)
                adapter = SnapshotAdapter(payload)
                context = req.screen_context.model_dump() if req.screen_context else None
                result = session.ask(req.text, offline=self.offline, model=self.model,
                                     data_adapter=adapter, screen_context=context)
                return reply_envelope(result, payload["snapshot_id"])
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
