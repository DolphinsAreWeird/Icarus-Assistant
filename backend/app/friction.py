"""The friction map: what users ask, where they get confused, and where they drop off.

Every question is a bug report. The backend logs events on its own (it doesn't rely on the model to remember), the app can
add its own through POST /events, and GET /friction/summary turns them into the numbers a business wants to see.

Privacy: users are pseudonymous (a short hash of the user id), and the log keeps a *topic* ("fee", "gold", "chart"),
never the question text. It lives in memory (bounded); set FRICTION_LOG_FILE to also append to a file.

Read the numbers carefully. A question shows demand for help, not proof that a screen is broken, and the counts are small
at a hackathon, so every figure comes with its denominator ("4 of 10 users").
"""
import hashlib
import json
import os
import re
import threading
import time
from collections import Counter, defaultdict, deque

from app import knowledge

MAX_EVENTS = 5000

# What the backend logs by itself, and what the app may add through POST /events.
AUTO_TYPES = {"question", "confusion", "refusal", "unanswered", "validation_failed", "preview_shown", "task_completed", "nudge_issued"}
APP_TYPES = {"task_started", "task_abandoned", "screen_view", "help_requested", "tap_explain", "nudge_shown", "nudge_opened"}
ALL_TYPES = AUTO_TYPES | APP_TYPES

CONFUSED = re.compile(r"\b(what (does|is|are|do)|what's|mean|means|meaning|explain|i don'?t (get|understand)|confus|how (does|do)|why)\b"
                      r"|คืออะไร|หมายความ|หมายถึง|อธิบาย|ไม่เข้าใจ|ทำไม|ยังไง", re.IGNORECASE)


def user_ref(user_id: str) -> str:
    return "p_" + hashlib.sha1(user_id.encode("utf-8")).hexdigest()[:8]


def _topics() -> list[tuple[str, re.Pattern]]:
    """Topic id -> a pattern for its words, from the reviewed glossary, the assets, and the how-to topics."""
    found: list[tuple[str, re.Pattern]] = []
    def pattern(words):
        parts = [(re.escape(w.lower()) if re.search(r"[฀-๿]", w) else rf"\b{re.escape(w.lower())}s?\b") for w in words if w]
        return re.compile("|".join(parts)) if parts else None
    for term_id, term in knowledge.glossary().items():
        p = pattern([term["en"], term["th"], *term.get("aliases", [])])
        if p:
            found.append((term_id, p))
    for asset in knowledge.assets().values():
        p = pattern(asset["aliases"])
        if p:
            found.append((asset["name"].split(" (")[0].lower(), p))
    for topic in knowledge.howto():
        found.append((f"how to {topic.replace('_', ' ')}", re.compile(rf"\b{re.escape(topic.replace('_', ' '))}\b")))
    return found


_TOPIC_CACHE: list | None = None


def classify_topic(text: str) -> str:
    """The first known topic the question mentions (a glossary term, an asset, a how-to), or 'other'."""
    global _TOPIC_CACHE
    if _TOPIC_CACHE is None:
        _TOPIC_CACHE = _topics()
    lowered = (text or "").lower()
    for topic, pattern in _TOPIC_CACHE:
        if pattern.search(lowered):
            return topic
    return "other"


class FrictionLog:
    def __init__(self, path: str | None = None, clock=time.time):
        self.events: deque = deque(maxlen=MAX_EVENTS)
        self.lock = threading.Lock()
        self.path = path if path is not None else os.getenv("FRICTION_LOG_FILE")
        self.clock = clock

    def log(self, event_type: str, *, user_id: str, session_id: str = "", screen: str | None = None, topic: str | None = None,
            lang: str | None = None, **extra) -> dict | None:
        """Record one event. Never raises: logging must not be able to break a screen."""
        try:
            if event_type not in ALL_TYPES:
                return None
            event = {"ts": round(self.clock(), 3), "type": event_type, "user": user_ref(str(user_id)), "session": str(session_id)[:64],
                     "screen": (str(screen)[:40] if screen else None), "topic": (str(topic)[:60] if topic else None),
                     "lang": lang if lang in ("en", "th") else None,
                     **{k: v for k, v in extra.items() if isinstance(v, (str, int, float, bool)) and len(str(v)) <= 80}}
            with self.lock:
                self.events.append(event)
                if self.path:
                    try:
                        with open(self.path, "a", encoding="utf-8") as f:
                            f.write(json.dumps(event, ensure_ascii=False) + "\n")
                    except OSError:
                        pass  # an unwritable file must not lose the in-memory log or break the request
            return event
        except Exception:
            return None

    def log_chat(self, req, reply, user_id: str) -> None:
        """What a /chat turn tells us: that a question was asked, about what, and whether it confused or went unanswered."""
        screen = req.screen_context.screen_id if req.screen_context else (req.snapshot or {}).get("screen")
        lang = req.lang or (reply.debug.get("lang") if isinstance(reply.debug, dict) else None)
        topic = classify_topic(req.text)
        base = dict(user_id=user_id, session_id=req.session_id, screen=screen, topic=topic, lang=lang, input_mode=req.input_mode)
        self.log("question", **base)
        if CONFUSED.search(req.text):
            self.log("confusion", **base)
        debug = reply.debug if isinstance(reply.debug, dict) else {}
        if debug.get("guard") == "advice" or debug.get("asks_for_advice"):
            self.log("refusal", **base)
        if reply.status != "ok":
            self.log("unanswered", **base, reason=reply.status)  # the questions we couldn't answer: what to prepare next
        if any(a.get("type") == "card" and a.get("card_type") == "trade_preview" for a in reply.ui_actions) or \
                any(a.get("type") == "review" for a in reply.ui_actions):
            self.log("preview_shown", **base)

    def summary(self) -> dict:
        with self.lock:
            events = list(self.events)
        users = {e["user"] for e in events}
        total_users = len(users)
        by_type = Counter(e["type"] for e in events)

        def top(event_type: str, n: int = 8) -> list[dict]:
            counts, who = Counter(), defaultdict(set)
            for e in events:
                if e["type"] == event_type and e.get("topic") and e["topic"] != "other":
                    counts[e["topic"]] += 1
                    who[e["topic"]].add(e["user"])
            return [{"topic": t, "asked": c, "users": len(who[t]), "of_users": total_users,
                     "text": f"{len(who[t])} of {total_users} users asked about {t}"} for t, c in counts.most_common(n)]

        screens: dict[str, Counter] = defaultdict(Counter)
        for e in events:
            if e.get("screen"):
                screens[e["screen"]][e["type"]] += 1
        started = {e["session"] for e in events if e["type"] in ("preview_shown", "task_started")}
        completed = {e["session"] for e in events if e["type"] == "task_completed"}
        return {
            "events": len(events), "users": total_users, "sessions": len({e["session"] for e in events if e["session"]}),
            "questions": by_type["question"], "by_type": dict(by_type),
            "top_questions": top("question"), "confusing": top("confusion"),
            "by_screen": {s: {"questions": c["question"], "confusion": c["confusion"], "nudges": c["nudge_issued"] + c["nudge_shown"],
                              "unanswered": c["unanswered"]} for s, c in sorted(screens.items())},
            "funnel": {"purchase_started": len(started), "purchase_completed": len(completed & started),
                       "text": f"{len(completed & started)} of {len(started)} purchase attempts completed"},
            "refusals": by_type["refusal"], "unanswered": by_type["unanswered"],
            "languages": dict(Counter(e["lang"] for e in events if e["type"] == "question" and e.get("lang"))),
            "note": "A question shows demand for help, not proof that a screen is broken. Counts are small: read them with the denominators.",
        }

    def clear(self) -> None:
        with self.lock:
            self.events.clear()
