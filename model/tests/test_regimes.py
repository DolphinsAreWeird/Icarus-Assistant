from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from evaluate_regimes import cutoffs


class RegimeTests(unittest.TestCase):
    def test_expanding_cutoffs_never_overlap_or_omit_latest_test(self):
        for length in (600, 601, 750, 800, 850, 1003, 1200, 2000):
            ends = cutoffs(length)
            self.assertEqual(ends[-1], length)
            for previous, current in zip(ends, ends[1:]):
                self.assertGreaterEqual(int(current*.8), previous)
            self.assertEqual(len(ends), len(set(ends)))
        self.assertEqual(cutoffs(1003), [600,800,1003])
        with self.assertRaises(ValueError):
            cutoffs(599)


if __name__ == "__main__":
    unittest.main()
