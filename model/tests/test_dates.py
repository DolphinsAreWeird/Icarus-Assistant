from datetime import date
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from assistant import answer
from session import ConversationSession
from icarus_core import ROOT


class DateTests(unittest.TestCase):
    def test_default_savings_uses_actual_day_not_old_demo_date(self):
        with patch("assistant.date") as clock:
            clock.today.return_value = date(2026,10,16)
            clock.fromisoformat.side_effect = date.fromisoformat
            result = answer("/goal 1000 0 THB 2026-10-16")
        self.assertEqual(result["calculation_date"], "2026-10-16")
        self.assertEqual(next(iter(result["tool_results"].values()))["contributions"], 1)

    def test_runtime_session_advances_but_fixed_demo_does_not(self):
        with patch("session.date") as clock:
            clock.today.return_value = date(2026,10,16)
            clock.fromisoformat.side_effect = date.fromisoformat
            runtime, fixed = ConversationSession(), ConversationSession(today="2026-10-15")
            clock.today.return_value = date(2026,10,17)
            self.assertEqual(runtime.today, "2026-10-17")
            self.assertEqual(fixed.today, "2026-10-15")

    def test_runtime_persistence_refreshes_and_legacy_dates_stay_explicit(self):
        root = ROOT/"results"/"test_tmp"
        root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=root) as folder:
            self.assertTrue(Path(folder).resolve().is_relative_to(root.resolve()))
            target = Path(folder)/"session.json"
            with patch("session.session_path", return_value=target), patch("session.date") as clock:
                clock.today.return_value = date(2026,10,16)
                clock.fromisoformat.side_effect = date.fromisoformat
                ConversationSession().save("demo")
                clock.today.return_value = date(2026,10,17)
                self.assertEqual(ConversationSession.load("demo").today, "2026-10-17")
                legacy = json.loads(target.read_text(encoding="utf-8"))
                legacy.pop("date_mode")
                target.write_text(json.dumps(legacy), encoding="utf-8")
                self.assertEqual(ConversationSession.load("demo").today, "2026-10-16")


if __name__ == "__main__":
    unittest.main()
