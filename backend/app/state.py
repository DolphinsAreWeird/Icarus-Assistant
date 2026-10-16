"""In-memory demo state: users, trade previews, chat sessions.

Loaded from data/seed/ and reset with POST /demo/reset. Nothing survives a restart,
which is what we want for rehearsals.
"""
from copy import deepcopy
import json
import re
import threading
import time

from app.config import SEED_DIR

# A visitor of the hosted demo gets their own copy of a demo user, e.g. "u_new-k3j9x2ab7q", so one judge's purchases
# never show up in another judge's account. The copy is made on first use; the oldest go when there are too many.
VISITOR_ID = re.compile(r"(u_[a-z]+)-([a-z0-9]{6,32})")
MAX_VISITORS = 500


class Users(dict):
    """The seed users, plus a fresh copy of one for each visitor id that asks for it."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._lock = threading.Lock()

    def _visitor(self, key):
        m = VISITOR_ID.fullmatch(key) if isinstance(key, str) else None
        if m is None or not dict.__contains__(self, m[1]):
            return None
        with self._lock:
            if dict.__contains__(self, key):
                return dict.__getitem__(self, key)
            visitors = [k for k in self if VISITOR_ID.fullmatch(k)]
            for old in visitors[:max(0, len(visitors) - MAX_VISITORS + 1)]:
                del self[old]
            user = deepcopy(dict.__getitem__(self, m[1]))
            user["user_id"] = key
            self[key] = user
            return user

    def __missing__(self, key):
        user = self._visitor(key)
        if user is None:
            raise KeyError(key)
        return user

    def __contains__(self, key):
        return dict.__contains__(self, key) or self._visitor(key) is not None

    def get(self, key, default=None):
        return self[key] if key in self else default


class DemoState:
    def __init__(self, seed_dir=SEED_DIR, clock=time.time):
        self.seed_dir = seed_dir
        self.clock = clock
        self.lock = threading.Lock()  # one confirm at a time, so a double tap can't buy twice
        self.reset()

    def reset(self) -> None:
        with self.lock:
            self.users = Users({p.stem: json.loads(p.read_text(encoding="utf-8"))
                                for p in sorted(self.seed_dir.glob("*.json"))})
            self.previews: dict[str, dict] = {}
            self.sessions: dict[str, list] = {}  # session_id -> model message history
