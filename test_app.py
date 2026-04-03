import unittest
import os
import sys
from unittest.mock import MagicMock

# Mock dependencies to avoid side effects during import
sys.modules['flask'] = MagicMock()
sys.modules['requests'] = MagicMock()

# Disable automatic runtime start
os.environ["AUTO_START_RUNTIME"] = "false"

from app import normalize_lane_type, wait_description

class TestNormalizeLaneType(unittest.TestCase):
    def test_clear_precheck(self):
        # Combined "clear" and "pre" returns "CLEAR_PRECHECK"
        self.assertEqual(normalize_lane_type("CLEAR PreCheck"), "CLEAR_PRECHECK")
        self.assertEqual(normalize_lane_type("clear tsa pre"), "CLEAR_PRECHECK")
        self.assertEqual(normalize_lane_type("  TSA PRE CLEAR  "), "CLEAR_PRECHECK")

    def test_clear(self):
        # "clear" returns "CLEAR"
        self.assertEqual(normalize_lane_type("CLEAR"), "CLEAR")
        self.assertEqual(normalize_lane_type("clear lane"), "CLEAR")

    def test_precheck(self):
        # "pre" returns "PRECHECK"
        self.assertEqual(normalize_lane_type("TSA PreCheck"), "PRECHECK")
        self.assertEqual(normalize_lane_type("precheck"), "PRECHECK")
        self.assertEqual(normalize_lane_type("TSA Pre"), "PRECHECK")
        self.assertEqual(normalize_lane_type("pre"), "PRECHECK")

        # Note: In the current implementation, "premium" also contains "pre" and returns "PRECHECK"
        self.assertEqual(normalize_lane_type("premium"), "PRECHECK")

    def test_standard(self):
        # Default fallback is "STANDARD"
        self.assertEqual(normalize_lane_type("Standard"), "STANDARD")
        self.assertEqual(normalize_lane_type("General"), "STANDARD")
        self.assertEqual(normalize_lane_type(""), "STANDARD")
        self.assertEqual(normalize_lane_type("some unknown lane"), "STANDARD")
        self.assertEqual(normalize_lane_type("Priority"), "STANDARD")


class TestWaitDescription(unittest.TestCase):
    def test_closed_zero_and_negative(self):
        # 0 or negative should return "Closed"
        self.assertEqual(wait_description(0), "Closed")
        self.assertEqual(wait_description(0.0), "Closed")
        self.assertEqual(wait_description(-5), "Closed")
        self.assertEqual(wait_description(-1.5), "Closed")

    def test_positive_integers(self):
        self.assertEqual(wait_description(1), "1 minutes")
        self.assertEqual(wait_description(5), "5 minutes")
        self.assertEqual(wait_description(10), "10 minutes")

    def test_rounding(self):
        # Floats should round to nearest int (Banker's rounding in Python 3)
        self.assertEqual(wait_description(5.4), "5 minutes")
        self.assertEqual(wait_description(5.5), "6 minutes")  # 5.5 rounds to 6
        self.assertEqual(wait_description(5.6), "6 minutes")
        self.assertEqual(wait_description(0.4), "Closed")     # 0.4 rounds to 0
        self.assertEqual(wait_description(0.5), "Closed")     # 0.5 rounds to 0 (Banker's rounding)
        self.assertEqual(wait_description(1.5), "2 minutes")  # 1.5 rounds to 2

if __name__ == "__main__":
    unittest.main()
