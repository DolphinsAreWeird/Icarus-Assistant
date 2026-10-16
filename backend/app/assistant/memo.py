"""What the assistant remembers between turns: model answers for a few minutes, and a log of questions.

AnswerCache keeps replies that needed the model, for the same normalized question on the same screen,
asset, chart period, tapped element, visible elements and typed amount, while the facts we would say are
unchanged (the fact packs' version), for ANSWER_CACHE_TTL_S seconds (default 300; 0 turns it off). Only
answers built from read-only tools are kept, never trades, cancels or guides, and only for questions that
don't lean on the conversation ("what about it?", "what do you mean", "and then?"). Only a session's FIRST
turn is kept or served: with any earlier history the model may have used it, so the answer is never stored
or reused. The key also holds the journey stage and the snapshot's label. The model has the user's own money
in its context, so an answer is kept for that user only, while their account and the app's snapshot are
unchanged. A cached answer is served only if its figures are still backed by the evidence stored with it.

QuestionLog writes one JSON line per question with the route that answered it (prepared, fastpath,
cache, model) to QUESTION_LOG (default backend/.runtime/questions.jsonl; 0 turns it off). The
questions that went to the model are the ones to prepare next: the log is the friction map.
"""
import copy
import json
import os
import re
import threading
import time
from collections import OrderedDict
from datetime import UTC, datetime
from pathlib import Path

from app.config import BACKEND_DIR

READ_ONLY_TOOLS = {"get_prices", "get_history", "get_asset_info", "explain_element", "get_portfolio", "show_chart",
                   "show_steps", "go_to_screen", "show_asset", "change_chart_period", "filter_assets", "highlight_element"}
BACK_REFERENCE = re.compile(r"\b(?:it|its|that|those|them|they|their|there|same|again|else|also|too|more|instead|"
                            r"what about|how about|you mean|mean by|go on|keep going|carry on)\b|"
                            r"^(?:and|but|or|then|like)\b|มัน|นั้น|ล่ะ|อีก|เหมือนกัน")
DEFAULT_LOG = BACKEND_DIR / ".runtime" / "questions.jsonl"


def standalone(norm: str) -> bool:
    """A question that means the same whatever was said before it."""
    return len(norm.split()) >= 2 and BACK_REFERENCE.search(norm) is None


def reusable(tools_used: list[str]) -> bool:
    """Can an answer that called these tools be given again? Not after a trade, a cancel or a guide."""
    return set(tools_used) <= READ_ONLY_TOOLS


class AnswerCache:
    def __init__(self, ttl_s: float = 300.0, max_items: int = 256, clock=time.monotonic):
        self.ttl_s, self.max_items, self.clock = ttl_s, max_items, clock
        self._items: OrderedDict = OrderedDict()
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "AnswerCache":
        return cls(float(os.getenv("ANSWER_CACHE_TTL_S", "300")))

    def get(self, key: tuple) -> dict | None:
        if self.ttl_s <= 0:
            return None
        with self._lock:
            item = self._items.get(key)
            if item is None or self.clock() - item[0] > self.ttl_s:
                self._items.pop(key, None)
                return None
            self._items.move_to_end(key)
            return copy.deepcopy(item[1])

    def put(self, key: tuple, value: dict) -> None:
        if self.ttl_s <= 0:
            return
        with self._lock:
            self._items[key] = (self.clock(), copy.deepcopy(value))
            self._items.move_to_end(key)
            while len(self._items) > self.max_items:
                self._items.popitem(last=False)


class QuestionLog:
    def __init__(self, path: Path | None):
        self.path = path
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "QuestionLog":
        value = os.getenv("QUESTION_LOG", str(DEFAULT_LOG))
        return cls(None if value in ("", "0") else Path(value))

    def write(self, **record) -> None:
        """One line per question. Never breaks a turn: a write that fails is skipped."""
        if self.path is None:
            return
        line = json.dumps({"at": datetime.now(UTC).isoformat(timespec="seconds"), **record}, ensure_ascii=False)
        try:
            with self._lock:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with self.path.open("a", encoding="utf-8") as f:
                    f.write(line + "\n")
        except OSError as e:
            print(f"[questions] can't write {self.path}: {e}", flush=True)
