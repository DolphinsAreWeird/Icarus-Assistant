"""Prepared answers: the questions people ask most, answered without the model.

data/prepared_answers.json lists them with the ways people ask, in English and Thai. Each answer is
one of: "do", a fast-path intent to run (open gold, set up a buy...); "say", a fixed text or a
template whose {slots} are filled from the fact packs when it's asked, so numbers are always current;
"glossary", a term from data/glossary.json. "do" with "say" runs the action and says the template.
Every glossary term also answers "what is <term>" on its own.

Matching, after normalize(): the question is one of the listed ways (exact); or it has the same
content words in any order, give or take a few small words; or, for Thai, which has no spaces to
split words on, it is nearly the same string with the same assets and numbers. A near miss goes to
the model, never to a wrong answer.
"""
import difflib
import json
import re
from functools import cache

from app import knowledge
from app.assistant.checks import THAI, asks_for_advice
from app.assistant.fastpath import Intent, run
from app.assistant.normalize import assets_in, normalize, numbers_in, risky
from app.config import DATA_DIR
from app.tools import _envelope

PATH = DATA_DIR / "prepared_answers.json"
# Small words that don't change what is asked. Not "my" (personal), "this" (the screen), "what" or "how".
STOP = {"a", "an", "the", "is", "are", "was", "do", "does", "did", "can", "could", "would", "will", "you", "your",
        "i", "me", "please", "just", "now", "right", "really", "exactly", "actually", "so", "to", "for", "of", "it"}
THAI_MIN_RATIO = 0.9
SLOT = re.compile(r"\{(\w+)\.(\w+)\}")
GLOSSARY_WAYS = {"en": ["what is {x}", "what is a {x}", "what is an {x}", "what are {x}", "what does {x} mean",
                        "define {x}", "explain {x}", "meaning of {x}"],
                 "th": ["{x}คืออะไร", "{x}หมายถึงอะไร", "{x}แปลว่าอะไร", "อธิบาย{x}"]}
# Glossary words that also name something on the screen or a number: the fast path or the model answer those.
GLOSSARY_SKIP = {"fee", "fees", "price", "current price", "chart", "line", "graph", "preview", "summary", "confirm",
                 "min", "minimum", "cash", "split", "ราคา", "กราฟ", "เส้น", "ยืนยัน", "ตรวจสอบ", "ค่าธรรมเนียม"}


def content_words(norm: str) -> frozenset:
    return frozenset(w for w in norm.split() if w not in STOP)


class PreparedAnswers:
    def __init__(self, path=PATH):
        self.entries = {e["id"]: e for e in json.loads(path.read_text(encoding="utf-8"))["answers"]}
        self.exact: dict[str, dict] = {}
        for term, t in knowledge.glossary().items():   # first, so the listed answers win a clash
            ways = [w for w in [t["en"].lower(), *t["aliases"]] if w.lower() not in GLOSSARY_SKIP]
            entry = {"id": f"glossary:{term}", "glossary": term, "ask": {
                lang: [p.format(x=w) for w in ways for p in GLOSSARY_WAYS[lang] if bool(THAI.search(w)) == (lang == "th")]
                for lang in ("en", "th")}}
            self._index(entry, overwrite=False)
        for entry in self.entries.values():
            self._index(entry, overwrite=True)
        self.by_words: dict[frozenset, dict | None] = {}
        self.thai: list[tuple[str, str, dict]] = []
        for norm, entry in self.exact.items():
            if THAI.search(norm):
                self.thai.append((norm.replace(" ", ""), norm, entry))
            else:
                self._by_words(content_words(norm), entry)

    def _by_words(self, words: frozenset, entry: dict) -> None:
        """Index by content words. A listed answer beats a glossary one; two listed answers: neither."""
        other = self.by_words.setdefault(words, entry)
        if other is None or other is entry:
            return
        glossary = other["id"].startswith("glossary:"), entry["id"].startswith("glossary:")
        if glossary == (True, False):
            self.by_words[words] = entry
        elif glossary != (False, True):
            self.by_words[words] = None

    def _index(self, entry: dict, overwrite: bool) -> None:
        for ways in entry["ask"].values():
            for way in ways:
                norm = normalize(way)
                if overwrite or norm not in self.exact:
                    self.exact[norm] = entry

    # ---------- matching ----------

    def match_exact(self, norm: str) -> dict | None:
        return self.exact.get(norm)

    def match_near(self, text: str, norm: str) -> dict | None:
        """Same content words, or for Thai nearly the same string with the same assets and numbers."""
        if not norm or risky(text, norm):
            return None
        if THAI.search(norm):
            squeezed, best, best_ratio = norm.replace(" ", ""), None, 0.0
            for candidate, candidate_norm, entry in self.thai:
                ratio = difflib.SequenceMatcher(None, squeezed, candidate).ratio()
                if ratio > best_ratio:
                    best, best_ratio = (candidate_norm, entry), ratio
            if best is None or best_ratio < THAI_MIN_RATIO:
                return None
            candidate_norm, entry = best
            same = assets_in(candidate_norm) == assets_in(norm) and numbers_in(candidate_norm) == numbers_in(norm)
            entry = entry if same else None
        else:
            entry = self.by_words.get(content_words(norm))
        if entry and asks_for_advice(text) and not self._is_advice(entry):
            return None  # "recommend" and friends: the model handles the nuance
        return entry

    @staticmethod
    def _is_advice(entry: dict) -> bool:
        return (entry.get("do") or {}).get("kind") == "advice"

    # ---------- answering ----------

    def answer(self, entry: dict, ctx, facts, lang: str, llm=None, here: str | None = None,
               user_text: str = "") -> tuple[str, int] | None:
        """(text, model calls), or None when this answer can't be given here (then nothing was changed)."""
        lang = "th" if lang == "th" else "en"
        calls = 0
        if entry.get("do"):
            args = dict(entry["do"])
            kind = args.pop("kind")
            if args.get("asset_id") == "here":
                args["asset_id"] = here or ctx.ui_state.asset
            done = run(Intent(kind, args), ctx, facts, lang, llm, user_text)
            if done is None:
                return None
            if not entry.get("say"):
                return done
            calls = done[1]
        if entry.get("glossary"):
            term = knowledge.glossary()[entry["glossary"]]
            _envelope(ctx, "glossary", {"term": term[lang], "explanation": term[f"explain_{lang}"]},
                      "glossary.json (written by us)")
            return term[f"explain_{lang}"], calls
        text = self.render(entry["say"][lang], ctx, facts, lang, here)
        return (text, calls) if text else None

    @staticmethod
    def render(template: str, ctx, facts, lang: str, here: str | None = None) -> str | None:
        """Fill {XAU.price}, {BTC.1Y}, {here.about}, {fees.min_buy}... from the fact packs, citing what is
        used. None if a slot has no value right now."""
        missing, cited = [], set()

        def fill(m: re.Match) -> str:
            pack, key = m.group(1), m.group(2)
            if pack == "fees":
                value, part = facts.fees["say"][lang].get(key), ("", "fees", None)
            else:
                asset = here if pack == "here" else pack
                say = facts.say(asset, lang) if asset else {}
                value = say.get("name", "").capitalize() or None if key == "Name" else say.get(key)
                period = key.split("_")[0]
                part = ((asset, "price", None) if key in ("price", "today", "today_short") else
                        (asset, "history", period) if period in (facts.assets.get(asset) or {}).get("history", {}) else
                        (asset, "about", None) if key == "about" else None)
            if value is None:
                missing.append(m.group(0))
                return ""
            if part and part not in cited:
                cited.add(part)
                facts.cite(ctx, part[0], part[1], part[2])
            return value

        text = SLOT.sub(fill, template)
        return None if missing else text


@cache
def default() -> PreparedAnswers:
    return PreparedAnswers()


def sample_questions() -> list[tuple[str, str]]:
    """The first way of asking each listed answer, per language: what pre-warming runs."""
    return [(ways[0], lang) for e in default().entries.values() for lang, ways in e["ask"].items() if ways]
