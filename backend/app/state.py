"""In-memory demo state: users, trade previews, chat sessions.

Loaded from data/seed/ and reset with POST /demo/reset. Nothing survives a restart,
which is what we want for rehearsals.
"""
import json
import threading
import time

from app.config import SEED_DIR


class DemoState:
    def __init__(self, seed_dir=SEED_DIR, clock=time.time):
        self.seed_dir = seed_dir
        self.clock = clock
        self.lock = threading.Lock()  # one confirm at a time, so a double tap can't buy twice
        self.reset()

    def reset(self) -> None:
        with self.lock:
            self.users = {p.stem: json.loads(p.read_text(encoding="utf-8"))
                          for p in sorted(self.seed_dir.glob("*.json"))}
            self.previews: dict[str, dict] = {}
            self.sessions: dict[str, list] = {}  # session_id -> model message history
