import unittest
import os
import sys
from unittest.mock import MagicMock

# Mock dependencies to avoid side effects during import
sys.modules['flask'] = MagicMock()
sys.modules['requests'] = MagicMock()

# Disable automatic runtime start
os.environ["AUTO_START_RUNTIME"] = "false"

from app import normalize_lane_type

class TestNormalizeLaneType(unittest.TestCase):
    @unittest.mock.patch("app.requests.get")
    def test_fetch_dtw_rows(self, mock_get):
        import app
        mock_resp = MagicMock()
        mock_resp.json.return_value = [
            {"Name": "Evans", "WaitTime": 3},
            {"Name": "McNamara", "WaitTime": 0}
        ]
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        rows = app.fetch_dtw_rows()
        self.assertEqual(len(rows), 2)

        self.assertEqual(rows[0]["checkpoint"], "Evans Terminal")
        self.assertEqual(rows[0]["wait_minutes"], 3.0)
        self.assertEqual(rows[0]["airport_code"], "DTW")
        self.assertEqual(rows[0]["source"], "https://proxy.metroairport.com/SkyFiiTSAProxy.ashx")

        self.assertEqual(rows[1]["checkpoint"], "McNamara Terminal")
        self.assertEqual(rows[1]["wait_minutes"], 0.0)

    @unittest.mock.patch.dict("os.environ", {"IAH_API_KEY": "fake_key"})
    @unittest.mock.patch("app.requests.get")
    def test_fetch_iah_rows(self, mock_get):
        import app

        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "data": {
                "wait_times": [
                    {"name": "Terminal A", "waitSeconds": 300, "isDisplayable": True, "lane": "General"},
                    {"name": "Terminal B", "waitSeconds": 60, "isDisplayable": False, "lane": "General"},
                    {"name": "Immigration", "waitSeconds": 1200, "isDisplayable": True, "lane": "FIS"}
                ]
            }
        }
        mock_resp.raise_for_status.return_value = None
        mock_get.return_value = mock_resp

        rows = app.fetch_iah_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["checkpoint"], "Terminal A")
        self.assertEqual(rows[0]["wait_minutes"], 5.0)
        self.assertEqual(rows[0]["airport_code"], "IAH")
        self.assertEqual(rows[0]["source"], "https://api.houstonairports.mobi/wait-times/checkpoint/iah")

    def test_clear_precheck(self):
        import app
        # Combined "clear" and "pre" returns "CLEAR_PRECHECK"
        self.assertEqual(app.normalize_lane_type("CLEAR PreCheck"), "CLEAR_PRECHECK")
        self.assertEqual(app.normalize_lane_type("clear tsa pre"), "CLEAR_PRECHECK")
        self.assertEqual(app.normalize_lane_type("  TSA PRE CLEAR  "), "CLEAR_PRECHECK")

    def test_clear(self):
        import app
        # "clear" returns "CLEAR"
        self.assertEqual(app.normalize_lane_type("CLEAR"), "CLEAR")
        self.assertEqual(app.normalize_lane_type("clear lane"), "CLEAR")

    def test_precheck(self):
        import app
        # "pre" returns "PRECHECK"
        self.assertEqual(app.normalize_lane_type("TSA PreCheck"), "PRECHECK")
        self.assertEqual(app.normalize_lane_type("precheck"), "PRECHECK")
        self.assertEqual(app.normalize_lane_type("TSA Pre"), "PRECHECK")
        self.assertEqual(app.normalize_lane_type("pre"), "PRECHECK")

        # Note: In the current implementation, "premium" also contains "pre" and returns "PRECHECK"
        self.assertEqual(app.normalize_lane_type("premium"), "PRECHECK")

    def test_standard(self):
        import app
        # Default fallback is "STANDARD"
        self.assertEqual(app.normalize_lane_type("Standard"), "STANDARD")
        self.assertEqual(app.normalize_lane_type("General"), "STANDARD")
        self.assertEqual(app.normalize_lane_type(""), "STANDARD")
        self.assertEqual(app.normalize_lane_type("some unknown lane"), "STANDARD")
        self.assertEqual(app.normalize_lane_type("Priority"), "STANDARD")

if __name__ == "__main__":
    unittest.main()
