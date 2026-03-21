#!/usr/bin/env python3
import logging
import os
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import requests
from flask import Flask, jsonify, render_template, request

APP_TZ = timezone.utc
DB_PATH = os.getenv("DB_PATH", "data.db")
POLL_SECONDS = int(os.getenv("POLL_SECONDS", "120"))
COLLECT_NOW_TOKEN = os.getenv("COLLECT_NOW_TOKEN")
ENABLE_POLLER = os.getenv("ENABLE_POLLER", "true").lower() == "true"
ENABLE_ADSENSE = os.getenv("ENABLE_ADSENSE", "false").lower() == "true"
ADSENSE_CLIENT = os.getenv("ADSENSE_CLIENT", "").strip()
ADSENSE_SLOT_TOP = os.getenv("ADSENSE_SLOT_TOP", "").strip()
ADSENSE_SLOT_BOTTOM = os.getenv("ADSENSE_SLOT_BOTTOM", "").strip()
SPONSOR_CTA_URL = os.getenv("SPONSOR_CTA_URL", "mailto:ads@secureline-live.com").strip()
SPONSOR_CTA_TEXT = os.getenv("SPONSOR_CTA_TEXT", "Advertise here").strip()
UA = {"User-Agent": "Mozilla/5.0 (tsa-live-site/1.0)"}

LIVE_AIRPORTS = {
    "PHL": {"name": "Philadelphia International (PHL)", "mode": "LIVE_PUBLIC"},
    "MIA": {"name": "Miami International (MIA)", "mode": "LIVE_KEY_REQUIRED"},
    "ORD": {"name": "Chicago O'Hare International (ORD)", "mode": "LIVE_PUBLIC"},
}
AIRPORT_FACTORS = {
    "ATL": 1.25, "BOS": 1.05, "CLT": 1.0, "DEN": 1.15, "DFW": 1.2, "DTW": 0.95,
    "EWR": 1.2, "FLL": 0.9, "HNL": 0.85, "IAH": 1.1, "JFK": 1.35, "LAS": 1.15,
    "LAX": 1.4, "LGA": 1.25, "MCO": 1.1, "MDW": 0.9, "MIA": 1.25, "MSP": 1.0,
    "ORD": 1.3, "PHL": 1.1, "PHX": 1.0, "SEA": 1.1, "SFO": 1.25, "SLC": 0.9,
    "TPA": 0.9, "JAX": 0.9,
}

PIPELINE_AIRPORTS = [
    {
        "code": "CLT",
        "name": "Charlotte Douglas International",
        "status": "IN_RESEARCH",
        "notes": "No public callable live JSON endpoint confirmed yet.",
    },
    {
        "code": "MCO",
        "name": "Orlando International",
        "status": "IN_RESEARCH",
        "notes": "No public callable live JSON endpoint confirmed yet.",
    },
    {
        "code": "JAX",
        "name": "Jacksonville International",
        "status": "IN_RESEARCH",
        "notes": "Checkpoint info visible, but no live wait JSON endpoint exposed.",
    },
]

app = Flask(__name__)
_mia_cache = {"key": None, "endpoint": None, "fetched_at": None}
_poll_lock = threading.Lock()
_runtime_started = False
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("secureline-live")


def start_runtime_once() -> None:
    global _runtime_started
    if _runtime_started:
        return
    init_db()
    with _poll_lock:
        collect_once()
    if ENABLE_POLLER:
        t = threading.Thread(target=poll_forever, daemon=True)
        t.start()
    _runtime_started = True
    logger.info("runtime_started db_path=%s poller=%s", DB_PATH, ENABLE_POLLER)


def utc_now() -> datetime:
    return datetime.now(tz=APP_TZ)


def clamp_wait_minutes(v: float) -> float:
    return max(0.0, min(float(v), 180.0))


def wait_description(minutes: float) -> str:
    m = int(round(minutes))
    if m <= 0:
        return "Closed"
    return f"{m} minutes"


def estimated_wait_for_hour(hour: int, factor: float) -> float:
    if hour < 5:
        base = 8
    elif hour < 7:
        base = 18
    elif hour < 10:
        base = 32
    elif hour < 13:
        base = 20
    elif hour < 16:
        base = 16
    elif hour < 19:
        base = 26
    elif hour < 22:
        base = 17
    else:
        base = 10
    return clamp_wait_minutes(base * factor)


def normalize_hourly_forecast(code: str, current_standard: float) -> List[Dict]:
    factor = AIRPORT_FACTORS.get(code, 1.0)
    rows = []
    for hour in range(24):
        estimated = estimated_wait_for_hour(hour, factor)
        blended = clamp_wait_minutes(estimated * 0.75 + current_standard * 0.25)
        start = datetime(2000, 1, 1, hour, 0)
        end = start + timedelta(hours=1)
        label = f"{start.strftime('%-I %p').lower()} - {end.strftime('%-I %p').lower()}"
        rows.append({"timeslot": label, "waittime": round(blended, 1), "hour": hour})
    return rows


def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS samples (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            airport_code TEXT NOT NULL,
            checkpoint TEXT NOT NULL,
            wait_minutes REAL NOT NULL,
            source TEXT NOT NULL,
            captured_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_samples_airport_time
        ON samples (airport_code, captured_at)
        """
    )
    conn.commit()
    conn.close()


def db_insert_rows(rows: List[Dict]) -> None:
    if not rows:
        return
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.executemany(
        """
        INSERT INTO samples (airport_code, checkpoint, wait_minutes, source, captured_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                r["airport_code"],
                r["checkpoint"],
                float(r["wait_minutes"]),
                r["source"],
                r["captured_at"],
            )
            for r in rows
        ],
    )
    conn.commit()
    conn.close()


def fetch_phl_rows() -> List[Dict]:
    url = "https://www.phl.org/phllivereach/metrics"
    resp = requests.get(url, headers=UA, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    zone_map = {
        "4126": "D/E TSA PreCheck",
        "3971": "D/E General",
        "4377": "A-West General",
        "4386": "A-East TSA PreCheck",
        "4368": "A-East General",
        "5047": "B General",
        "5052": "C General",
        "5068": "F General",
    }
    rows = []
    stamp = utc_now().isoformat()
    for row in payload.get("content", {}).get("rows", []):
        zone_id = str(row[0])
        if zone_id not in zone_map:
            continue
        wait_minutes = float(row[1])
        rows.append(
            {
                "airport_code": "PHL",
                "checkpoint": zone_map[zone_id],
                "wait_minutes": wait_minutes,
                "source": url,
                "captured_at": stamp,
            }
        )
    return rows


def refresh_mia_api_key_if_needed(force: bool = False) -> None:
    now = utc_now()
    if not force and _mia_cache["key"] and _mia_cache["fetched_at"]:
        age = now - _mia_cache["fetched_at"]
        if age < timedelta(hours=1):
            return

    page = requests.get("https://www.miami-airport.com/tsa-waittimes.asp", headers=UA, timeout=20).text
    js_paths = re.findall(r'<script[^>]+src=["\']([^"\']*js/wait-times/main[^"\']+\.js)["\']', page, re.I)
    if not js_paths:
        raise RuntimeError("MIA main wait-times bundle not found")
    main_js_url = "https://www.miami-airport.com" + js_paths[0]
    js = requests.get(main_js_url, headers=UA, timeout=20).text
    endpoint_match = re.search(r"https://waittime\.api\.aero/waittime/v2/current/[A-Z]+", js)
    key_match = re.search(r'x-apikey\\?"\s*:\\?"([a-f0-9]{20,})', js, re.I)
    if not endpoint_match or not key_match:
        raise RuntimeError("MIA endpoint or x-apikey not found in JS bundle")
    _mia_cache["endpoint"] = endpoint_match.group(0)
    _mia_cache["key"] = key_match.group(1)
    _mia_cache["fetched_at"] = now


def fetch_mia_rows() -> List[Dict]:
    refresh_mia_api_key_if_needed()
    endpoint = _mia_cache["endpoint"]
    key = _mia_cache["key"]
    resp = requests.get(endpoint, headers={**UA, "x-apikey": key}, timeout=20)
    if resp.status_code == 403:
        refresh_mia_api_key_if_needed(force=True)
        resp = requests.get(_mia_cache["endpoint"], headers={**UA, "x-apikey": _mia_cache["key"]}, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    stamp = utc_now().isoformat()
    rows = []
    for rec in payload.get("current", []):
        qname = rec.get("queueName")
        status = str(rec.get("status", "")).strip().lower()
        # Keep only open lanes when status metadata is present.
        if status and status != "open":
            continue
        min_wait = rec.get("projectedMinWaitMinutes")
        max_wait = rec.get("projectedMaxWaitMinutes")
        wait_val = None
        if min_wait is not None and max_wait is not None:
            wait_val = (float(min_wait) + float(max_wait)) / 2.0
        elif min_wait is not None:
            wait_val = float(min_wait)
        elif rec.get("projectedWaitTime") is not None:
            wait_val = float(rec.get("projectedWaitTime"))
        if qname is None or wait_val is None:
            continue
        wait_val = max(0.0, float(wait_val))
        rows.append(
            {
                "airport_code": "MIA",
                "checkpoint": qname,
                "wait_minutes": wait_val,
                "source": endpoint,
                "captured_at": stamp,
            }
        )
    return rows

def ord_friendly_checkpoint(metric_name: str) -> str:
    s = metric_name.lower()
    mapping = [
        ("t2c5general", "Terminal 2 — Checkpoint 5 General"),
        ("t2c5precheck", "Terminal 2 — Checkpoint 5 TSA PreCheck"),
        ("t3c6", "Terminal 3 — Checkpoint 6"),
        ("t3c7general", "Terminal 3 — Checkpoint 7 General"),
        ("t3c7a", "Terminal 3 — Checkpoint 7A"),
        ("t3c8general", "Terminal 3 — Checkpoint 8 General"),
        ("t3c8precheck", "Terminal 3 — Checkpoint 8 TSA PreCheck"),
        ("t3c9", "Terminal 3 — Checkpoint 9"),
        ("t5c10", "Terminal 5 — Checkpoint 10"),
        ("security02floor", "Terminal 1 — Economy"),
        ("tsafloor", "Terminal 1 — TSA PreCheck"),
        ("pafloor", "Terminal 1 — Priority"),
    ]
    for key, label in mapping:
        if key in s:
            return label
    return metric_name




def fetch_ord_rows() -> List[Dict]:
    endpoint = "https://tsawaittimes.flychicago.com/tsawaittimes"
    resp = requests.get(endpoint, headers=UA, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    stamp = utc_now().isoformat()
    rows = []
    for rec in payload:
        name = rec.get("name", "")
        wait_seconds = rec.get("waitTimes")
        if wait_seconds is None:
            continue
        # Ignore sentinel invalid values.
        if float(wait_seconds) >= 400000:
            continue
        wait_minutes = max(0.0, float(wait_seconds) / 60.0)
        rows.append(
            {
                "airport_code": "ORD",
                "checkpoint": ord_friendly_checkpoint(name),
                "wait_minutes": wait_minutes,
                "source": endpoint,
                "captured_at": stamp,
            }
        )
    return rows


def collect_once() -> Dict:
    result = {"ok": [], "errors": []}
    collectors = [
        ("PHL", fetch_phl_rows),
        ("MIA", fetch_mia_rows),
        ("ORD", fetch_ord_rows),
    ]
    all_rows = []
    for code, fn in collectors:
        try:
            rows = fn()
            all_rows.extend(rows)
            result["ok"].append({"airport": code, "rows": len(rows)})
            logger.info("collector_success airport=%s rows=%s", code, len(rows))
        except Exception as e:
            result["errors"].append({"airport": code, "error": str(e)})
            logger.exception("collector_failure airport=%s", code)
    db_insert_rows(all_rows)
    return result


def poll_forever() -> None:
    logger.info("poller_started interval_seconds=%s", POLL_SECONDS)
    while True:
        with _poll_lock:
            collect_once()
        time.sleep(POLL_SECONDS)


def latest_snapshot() -> Dict:
    cutoff = (utc_now() - timedelta(minutes=15)).isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT airport_code, checkpoint, wait_minutes, source, captured_at
        FROM samples
        WHERE captured_at >= ?
        ORDER BY captured_at DESC
        """
        ,
        (cutoff,),
    )
    rows = cur.fetchall()
    conn.close()
    out: Dict[str, List[Dict]] = {}
    seen = set()
    for airport_code, checkpoint, wait_minutes, source, captured_at in rows:
        if airport_code == "ORD":
            checkpoint = ord_friendly_checkpoint(checkpoint)
        key = (airport_code, checkpoint)
        if key in seen:
            continue
        seen.add(key)
        out.setdefault(airport_code, []).append(
            {
                "checkpoint": checkpoint,
                "wait_minutes": wait_minutes,
                "source": source,
                "captured_at": captured_at,
            }
        )
    return out


def latest_for_code(airport_code: str) -> List[Dict]:
    return latest_snapshot().get(airport_code, [])


def normalized_current_wait_for_code(code: str) -> Dict:
    rows = latest_for_code(code)
    if rows:
        active = [r for r in rows if float(r.get("wait_minutes", 0)) > 0]
        sample = active if active else rows
        values = [clamp_wait_minutes(float(r.get("wait_minutes", 0))) for r in sample]
        standard = round(sum(values) / len(values), 1) if values else 0.0
        has_pre = any("pre" in str(r.get("checkpoint", "")).lower() for r in rows)
        latest_ts = max(rows, key=lambda r: r.get("captured_at", ""))["captured_at"]
        return {
            "available": True,
            "sourceType": "live_direct",
            "sourceReason": "fresh_live_data",
            "currentWait": {
                "standard": standard,
                "standardDescription": wait_description(standard),
                "userReported": None,
                "precheck": has_pre,
                "timestamp": latest_ts,
            },
            "hourlyForecast": normalize_hourly_forecast(code, standard),
        }

    now = utc_now()
    estimated = round(estimated_wait_for_hour(now.hour, AIRPORT_FACTORS.get(code, 1.0)), 1)
    if code in LIVE_AIRPORTS:
        source_reason = "live_stale_or_unavailable"
    else:
        source_reason = "airport_not_live_integrated"
    return {
        "available": True,
        "sourceType": "estimated_fallback",
        "sourceReason": source_reason,
        "currentWait": {
            "standard": estimated,
            "standardDescription": wait_description(estimated),
            "userReported": None,
            "precheck": False,
            "timestamp": now.isoformat(),
        },
        "hourlyForecast": normalize_hourly_forecast(code, estimated),
    }


def history_for_airport(airport_code: str, hours: int = 12) -> List[Dict]:
    cutoff = (utc_now() - timedelta(hours=hours)).isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT airport_code, checkpoint, wait_minutes, captured_at
        FROM samples
        WHERE airport_code = ? AND captured_at >= ?
        ORDER BY captured_at ASC
        """,
        (airport_code, cutoff),
    )
    rows = cur.fetchall()
    conn.close()
    return [
        {
            "airport_code": r[0],
            "checkpoint": r[1],
            "wait_minutes": r[2],
            "captured_at": r[3],
        }
        for r in rows
    ]


@app.route("/")
def index():
    return render_template(
        "index.html",
        live_airports=LIVE_AIRPORTS,
        pipeline_airports=PIPELINE_AIRPORTS,
        monetization={
            "enable_adsense": ENABLE_ADSENSE and bool(ADSENSE_CLIENT),
            "adsense_client": ADSENSE_CLIENT,
            "adsense_slot_top": ADSENSE_SLOT_TOP,
            "adsense_slot_bottom": ADSENSE_SLOT_BOTTOM,
            "sponsor_cta_url": SPONSOR_CTA_URL,
            "sponsor_cta_text": SPONSOR_CTA_TEXT,
        },
    )


@app.route("/api/live")
def api_live():
    return jsonify(
        {
            "generated_at": utc_now().isoformat(),
            "live_airports": LIVE_AIRPORTS,
            "data": latest_snapshot(),
        }
    )


@app.route("/api/history")
def api_history():
    code = request.args.get("airport", "PHL").upper()
    hours = int(request.args.get("hours", "12"))
    if code not in LIVE_AIRPORTS:
        return jsonify({"error": "Unknown airport"}), 400
    return jsonify(
        {
            "airport": code,
            "generated_at": utc_now().isoformat(),
            "rows": history_for_airport(code, hours=hours),
        }
    )

@app.route("/api/tsa-wait-times")
def api_tsa_wait_times():
    code = request.args.get("code", "").upper().strip()
    if not re.fullmatch(r"[A-Z]{3}", code):
        return jsonify(
            {
                "code": code,
                "available": False,
                "error": "Invalid Airport Code",
                "timestamp": utc_now().isoformat(),
            }
        ), 400
    payload = normalized_current_wait_for_code(code)
    return jsonify({"code": code, **payload, "timestamp": utc_now().isoformat()})


@app.route("/api/pipeline")
def api_pipeline():
    return jsonify({"generated_at": utc_now().isoformat(), "airports": PIPELINE_AIRPORTS})

@app.route("/healthz")
def healthz():
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute("SELECT 1")
        conn.close()
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 500
    return jsonify({"ok": True, "generated_at": utc_now().isoformat()})


@app.route("/api/collect-now", methods=["POST"])
def api_collect_now():
    expected = COLLECT_NOW_TOKEN
    if expected:
        provided = request.headers.get("x-collect-token")
        if provided != expected:
            return jsonify({"error": "Unauthorized"}), 401
    with _poll_lock:
        result = collect_once()
    return jsonify(result)


if __name__ == "__main__":
    start_runtime_once()
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
else:
    # Enable initialization when loaded by WSGI servers (e.g. gunicorn).
    if os.getenv("AUTO_START_RUNTIME", "true").lower() == "true":
        start_runtime_once()
