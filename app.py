#!/usr/bin/env python3
import logging
import os
import re
import sqlite3
import json
import threading
import time
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse
from datetime import datetime, timedelta, timezone
from typing import Dict, List

import requests
from flask import Flask, Response, jsonify, redirect, render_template, request, send_from_directory

APP_TZ = timezone.utc
# Bulletproof DB Path: Check for Render Disk, fallback to local
_raw_db_path = os.getenv("DB_PATH", "").strip()
if _raw_db_path:
    DB_PATH = _raw_db_path
elif os.path.isdir("/data") and os.access("/data", os.W_OK):
    DB_PATH = "/data/data.db"
else:
    DB_PATH = "data.db"

# Safe int conversion
_poll_env = os.getenv("POLL_SECONDS", "").strip()
POLL_SECONDS = int(_poll_env) if _poll_env.isdigit() else 120
COLLECT_NOW_TOKEN = os.getenv("COLLECT_NOW_TOKEN")
ENABLE_POLLER = os.getenv("ENABLE_POLLER", "true").lower() == "true"
ENABLE_ADSENSE = os.getenv("ENABLE_ADSENSE", "false").lower() == "true"
ADSENSE_CLIENT = os.getenv("ADSENSE_CLIENT", "").strip()
ADSENSE_SLOT_TOP = os.getenv("ADSENSE_SLOT_TOP", "").strip()
ADSENSE_SLOT_BOTTOM = os.getenv("ADSENSE_SLOT_BOTTOM", "").strip()

# Emerald Ad Network (Performance ads)
EMERALD_ID = os.getenv("EMERALD_ID", "519508").strip()
EMERALD_TAG = os.getenv("EMERALD_TAG", "1").strip()
GA_MEASUREMENT_ID = os.getenv("GA_MEASUREMENT_ID", "G-9MN7W14PC1").strip()


SPONSOR_CTA_URL = os.getenv("SPONSOR_CTA_URL", "mailto:ads@tsatracker.com").strip()
SPONSOR_CTA_TEXT = os.getenv("SPONSOR_CTA_TEXT", "Advertise here").strip()

# Travelpayouts / Klook
TRAVELPAYOUTS_ID = os.getenv("TRAVELPAYOUTS_ID", "").strip()
TRAVELPAYOUTS_TOKEN = os.getenv("TRAVELPAYOUTS_TOKEN", "").strip()
# Affiliate monetization links.
# We append the marker directly because tp.media deep links require extra program-specific ids
# that are not configured in this app.
UBER_AFFILIATE_URL = os.getenv("UBER_AFFILIATE_URL", "https://www.uber.com/").strip()
LYFT_AFFILIATE_URL = os.getenv("LYFT_AFFILIATE_URL", "https://www.lyft.com/").strip()
PARKING_AFFILIATE_URL = os.getenv("PARKING_AFFILIATE_URL", "https://parking.com/").strip()
AIRHELP_AFFILIATE_URL = os.getenv("AIRHELP_AFFILIATE_URL", "https://airhelp.tpo.li/iHq6wvHP").strip()
KIWI_AIRPORT_PAGE_URLS = {
    "JFK": "https://www.kiwi.com/us/airport/jfk/john-f-kennedy-international-new-york-city-new-york-united-states/",
}

def get_tp_link(dest_url: str) -> str:
    if not TRAVELPAYOUTS_ID:
        return dest_url
    parsed = urlparse(dest_url)
    params = dict(parse_qsl(parsed.query, keep_blank_values=True))
    params.setdefault("marker", TRAVELPAYOUTS_ID)
    return urlunparse(parsed._replace(query=urlencode(params)))


def get_kiwi_link(airport_code: str = "") -> str:
    code = airport_code.upper().strip()
    base = KIWI_AIRPORT_PAGE_URLS.get(
        code,
        f"https://www.kiwi.com/us/?destination=anywhere&inboundDate=-&origin={code or '-'}&outboundDate=anytime",
    )
    return get_tp_link(base)

LOUNGE_AFFILIATE_URL = get_tp_link("https://www.prioritypass.com/")
KIWI_AFFILIATE_URL = get_tp_link("https://www.kiwi.com/")
KLOOK_AFFILIATE_URL = get_tp_link("https://www.klook.com/")

def get_lite_brain_insights() -> List[str]:
    """Reads recent notes from the 'Lite Brain' to identify manual optimization cues."""
    try:
        # Connect to the external Lite Brain DB
        lb_conn = sqlite3.connect('/Users/benbirkhahn/lite-brain/smart-clipboard.db')
        cur = lb_conn.cursor()
        # Look for snippets containing monetization keywords from the last 24 hours
        cur.execute("SELECT content FROM context_snippets WHERE created_at >= datetime('now', '-1 day')")
        rows = cur.fetchall()
        lb_conn.close()
        return [r[0] for r in rows]
    except Exception as e:
        logger.error("Could not read Lite Brain: %s", e)
        return []


def get_best_offer_id(airport_code: str = None) -> str:
    """The 'Self-Learning' core: calculates CTR and checks Lite Brain insights to pick the winner."""
    insights = " ".join(get_lite_brain_insights()).lower()
    
    # Priority 1: Manual Lite Brain Override (The 'Brain' knows best)
    if "focus on klook" in insights: return "KLOOK"
    if "kiwi is better" in insights: return "KIWI"
    
    # Priority 2: Real-time Data (The 'Code' learns from users)
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        
        # Local Sort: What do users at THIS airport click most?
        if airport_code:
            cur.execute(
                "SELECT offer_id, COUNT(*) as c FROM ad_clicks WHERE airport_code = ? GROUP BY offer_id ORDER BY c DESC LIMIT 1", 
                (airport_code,)
            )
        else:
            cur.execute("SELECT offer_id, COUNT(*) as c FROM ad_clicks GROUP BY offer_id ORDER BY c DESC LIMIT 1")
            
        row = cur.fetchone()
        conn.close()
        return row[0] if row else "KIWI"
    except:
        return "KIWI"


def get_monetization_context(airport_code: str = "") -> Dict:
    """Returns a dictionary of all monetization and affiliate data, now with Smart Ranking."""
    is_airport_page = bool(airport_code and airport_code in LIVE_AIRPORTS)
    city = LIVE_AIRPORTS[airport_code].get("city", "") if is_airport_page else ""
    best_offer = get_best_offer_id(airport_code)
    
    return {
        "enable_adsense": ENABLE_ADSENSE and bool(ADSENSE_CLIENT),
        "adsense_client": ADSENSE_CLIENT,
        "adsense_slot_top": ADSENSE_SLOT_TOP,
        "adsense_slot_bottom": ADSENSE_SLOT_BOTTOM,
        "emerald_id": EMERALD_ID,
        "emerald_tag": EMERALD_TAG,
        "ga_id": GA_MEASUREMENT_ID,
        "travelpayouts_id": TRAVELPAYOUTS_ID,

        "best_offer_id": best_offer,
        "smart_learning_active": True,
        "clear_url": os.getenv("CLEAR_AFFILIATE_URL", "https://www.clearme.com/").strip(),
        "precheck_url": os.getenv("PRECHECK_AFFILIATE_URL", "https://www.tsa.gov/precheck").strip(),
        "local_offer": LOCAL_OFFERS.get(airport_code),
        "klook_url": (
            get_tp_link(f"https://www.klook.com/en-US/search?query={city}")
            if is_airport_page and city and TRAVELPAYOUTS_ID
            else KLOOK_AFFILIATE_URL
        ),
        "kiwi_url": get_kiwi_link(airport_code) if is_airport_page else KIWI_AFFILIATE_URL,
        "lyft_url": LYFT_AFFILIATE_URL,
        "parking_url": PARKING_AFFILIATE_URL,
        "airhelp_url": AIRHELP_AFFILIATE_URL,
        "lounge_url": LOUNGE_AFFILIATE_URL,
    }

# Top Airport Personalized Offers (Revenue Boosters)
LOCAL_OFFERS = {
    "JFK": {
        "title": "JFK AirTrain & Transfers",
        "sub": "Fastest way to Manhattan — pre-book",
        "url": get_tp_link("https://www.klook.com/en-US/search?query=JFK airport transfer"),
        "icon": "🚈"
    },
    "ORD": {
        "title": "Chicago L Train & Shuttles",
        "sub": "Direct to the Loop — book transfer",
        "url": get_tp_link("https://www.klook.com/en-US/search?query=Chicago+Transfer"),
        "icon": "🚆"
    },
    "MCO": {
        "title": "Disney & Universal Shuttles",
        "sub": "Skip the taxi line — pre-book now",
        "url": get_tp_link("https://www.klook.com/en-US/search?query=Orlando+Shuttle"),
        "icon": "🚐"
    }
}
TRAVEL_INSURANCE_URL = os.getenv("TRAVEL_INSURANCE_URL", "https://www.travelinsurance.com/").strip()
SITE_URL = os.getenv("SITE_URL", "https://tsatracker.com").strip().rstrip("/")
_publisher_token = ADSENSE_CLIENT.replace("ca-", "").strip() if ADSENSE_CLIENT else ""
ADS_TXT_LINE = os.getenv(
    "ADS_TXT_LINE",
    f"google.com, {_publisher_token}, DIRECT, f08c47fec0942fa0" if _publisher_token.startswith("pub-") else "",
).strip()
UA = {"User-Agent": "Mozilla/5.0 (tsa-live-site/1.0)"}

LIVE_AIRPORTS = {
    "PHL": {"name": "Philadelphia International (PHL)", "mode": "LIVE_PUBLIC", "city": "Philadelphia"},
    "MIA": {"name": "Miami International (MIA)", "mode": "LIVE_KEY_REQUIRED", "city": "Miami"},
    "ORD": {"name": "Chicago O'Hare International (ORD)", "mode": "LIVE_PUBLIC", "city": "Chicago"},
    "CLT": {"name": "Charlotte Douglas International (CLT)", "mode": "LIVE_KEY_REQUIRED", "city": "Charlotte"},
    "MCO": {"name": "Orlando International (MCO)", "mode": "LIVE_KEY_REQUIRED", "city": "Orlando"},
    "JAX": {"name": "Jacksonville International (JAX)", "mode": "LIVE_PUBLIC", "city": "Jacksonville"},
    "DFW": {"name": "Dallas/Fort Worth International (DFW)", "mode": "LIVE_KEY_EMBEDDED", "city": "Dallas"},
    "LAX": {"name": "Los Angeles International (LAX)", "mode": "LIVE_PUBLIC", "city": "Los Angeles"},
    "JFK": {"name": "John F. Kennedy International (JFK)", "mode": "LIVE_PUBLIC", "city": "New York"},
    "EWR": {"name": "Newark Liberty International (EWR)", "mode": "LIVE_PUBLIC", "city": "Newark"},
    "LGA": {"name": "LaGuardia Airport (LGA)", "mode": "LIVE_PUBLIC", "city": "New York"},
    "SEA": {"name": "Seattle-Tacoma International (SEA)", "mode": "LIVE_PUBLIC", "city": "Seattle"},
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
        "code": "ATL",
        "name": "Hartsfield-Jackson Atlanta International (ATL)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
    },
    {
        "code": "DEN",
        "name": "Denver International (DEN)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
    },

    {
        "code": "SFO",
        "name": "San Francisco International",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: flysfo.com/flight-info/alerts-advisories/tsa-lines-normal-wait-times
        # returns 200 but wait-time data is loaded dynamically (JS/AJAX) — not in static HTML.
        # No public JSON API or skydive/mobi endpoint found. Drupal site, no Next.js bundle.
        # See airport_research/pipeline/SFO.md for full investigation log.
    },
    {
        "code": "IAH",
        "name": "George Bush Intercontinental (IAH)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: fly2houston.com/iah/security renders wait times dynamically (JS/AJAX).
        # No public JSON API or skydive/mobi endpoint found. Wait-time data loaded client-side.
        # See airport_research/pipeline/IAH.md for full investigation log.
    },
    {
        "code": "LAS",
        "name": "Harry Reid International (LAS)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: harryreidairport.com/Flights/Security renders wait times dynamically.
        # No public JSON API found. Requires headless browser or XHR interception.
        # See airport_research/pipeline/LAS.md for full investigation log.
    },
    {
        "code": "BWI",
        "name": "Baltimore/Washington International (BWI)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: bwiairport.com/at-bwi/airport-security renders wait times dynamically.
        # No public JSON API found. Requires headless browser or XHR interception.
        # See airport_research/pipeline/BWI.md for full investigation log.
    },
    {
        "code": "DTW",
        "name": "Detroit Metropolitan (DTW)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: metroairport.com/at-the-airport/security renders wait times dynamically.
        # No public JSON API found. Requires headless browser or XHR interception.
        # See airport_research/pipeline/DTW.md for full investigation log.
    },
    {
        "code": "IAD",
        "name": "Washington Dulles International (IAD)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: flydulles.com and mwaa.com both render wait times dynamically.
        # No public JSON API found. Both are MWAA-operated (same backend).
        # See airport_research/pipeline/IAD.md for full investigation log.
    },
    {
        "code": "DCA",
        "name": "Ronald Reagan Washington National (DCA)",
        "status": "IN_RESEARCH",
        "public_note": "Live integration coming soon.",
        # internal: flyreagan.com and mwaa.com both render wait times dynamically.
        # No public JSON API found. Both are MWAA-operated (same backend as IAD).
        # See airport_research/pipeline/DCA.md for full investigation log.
    },
]

app = Flask(__name__)
_mia_cache = {"key": None, "endpoint": None, "fetched_at": None}
_clt_cache = {
    "key": None,
    "version": None,
    "endpoint": "https://api.cltairport.mobi/wait-times/checkpoint/CLT",
    "fetched_at": None,
}
_mco_cache = {
    "endpoint": "https://api.goaa.aero/wait-times/checkpoint/MCO",
    "key": os.getenv("MCO_API_KEY", "8eaac7209c824616a8fe58d22268cd59"),
    "version": os.getenv("MCO_API_VERSION", "140"),
}
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("tsa-tracker")
_db_init_lock = threading.Lock()
_db_initialized = False
_poll_lock = threading.Lock()
_poller_started = False


def poll_forever() -> None:
    logger.info("poller_started poll_seconds=%s db_path=%s", POLL_SECONDS, DB_PATH)
    while True:
        try:
            with _poll_lock:
                collect_once()
        except Exception:
            logger.exception("poller_cycle_failed")
        time.sleep(POLL_SECONDS)

def start_web_runtime_once() -> None:
    global _db_initialized, _poller_started
    with _db_init_lock:
        if _db_initialized:
            return
        init_db()
        with _poll_lock:
            collect_once()
        if ENABLE_POLLER and not _poller_started:
            thread = threading.Thread(target=poll_forever, name="tsa-poller", daemon=True)
            thread.start()
            _poller_started = True
        _db_initialized = True
    logger.info("web_runtime_started db_path=%s", DB_PATH)


def utc_now() -> datetime:
    return datetime.now(tz=APP_TZ)


def airport_seo_slug(code: str) -> str:
    return f"/airports/{code.lower()}-tsa-wait-times"


def build_page_seo(title: str, description: str, canonical_path: str) -> Dict:
    return {
        "title": title,
        "description": description,
        "canonical_url": f"{SITE_URL}{canonical_path}",
        "site_url": SITE_URL,
    }


def home_page_seo() -> Dict:
    return build_page_seo(
        title="Live TSA Wait Times at Major US Airports | TSA Tracker",
        description=(
            "Real-time TSA security wait times for PHL, MIA, ORD, LAX, JFK, EWR, LGA, SEA, DFW and more. "
            "Live airport security line data pulled directly from official airport systems — updated every 2 minutes."
        ),
        canonical_path="/",
    )


def airport_page_seo(code: str, airport_name: str) -> Dict:
    clean_name = airport_name.split("(")[0].strip()
    return build_page_seo(
        title=f"{code} TSA Wait Times — Live Security Line Data | {clean_name} | TSA Tracker",
        description=(
            f"Live TSA security checkpoint wait times at {clean_name} ({code}). "
            f"Real-time airport security line data pulled directly from official {code} airport systems and updated every 2 minutes."
        ),
        canonical_path=airport_seo_slug(code),
    )


def legal_page_seo(slug: str) -> Dict:
    mapping = {
        "privacy": ("Privacy Policy", "Read TSA Tracker's privacy policy and data handling details."),
        "terms": ("Terms of Service", "Read TSA Tracker's terms for using TSA wait-time services."),
        "contact": ("Contact", "Contact TSA Tracker for support, data questions, or partnerships."),
        "methodology": ("Methodology", "How TSA Tracker sources, validates, and updates airport TSA wait time data."),
    }
    title, description = mapping[slug]
    return build_page_seo(
        title=f"{title} | TSA Tracker",
        description=description,
        canonical_path=f"/{slug}",
    )


def index_template_context(initial_airport_code: str, seo: Dict) -> Dict:
    is_airport_page = bool(initial_airport_code and initial_airport_code in LIVE_AIRPORTS)
    airport_display_name = ""
    initial_data = None
    initial_checkpoints = []
    if is_airport_page:
        raw_name = LIVE_AIRPORTS[initial_airport_code]["name"]
        airport_display_name = raw_name.split("(")[0].strip()
        try:
            initial_data = normalized_current_wait_for_code(initial_airport_code)
            initial_checkpoints = latest_for_code(initial_airport_code)
        except Exception as e:
            logger.error("Error fetching initial data for %s: %s", initial_airport_code, e)
        if initial_data is None:
            estimated = round(estimated_wait_for_hour(utc_now().hour, AIRPORT_FACTORS.get(initial_airport_code, 1.0)), 1)
            initial_data = {
                "available": True,
                "sourceType": "estimated_fallback",
                "sourceReason": "initial_page_fallback",
                "currentWait": {
                    "standard": estimated,
                    "standardDescription": wait_description(estimated),
                    "userReported": None,
                    "precheck": False,
                    "timestamp": utc_now().isoformat(),
                },
                "hourlyForecast": normalize_hourly_forecast(initial_airport_code, estimated),
            }
    try:
        monetization = get_monetization_context(initial_airport_code)
    except Exception as e:
        logger.error("Error building monetization context for %s: %s", initial_airport_code or "HOME", e)
        monetization = get_monetization_context("")
    return {
        "live_airports": LIVE_AIRPORTS,
        "pipeline_airports": PIPELINE_AIRPORTS,
        "initial_airport_code": initial_airport_code,
        "is_airport_page": is_airport_page,
        "airport_display_name": airport_display_name,
        "airport_city": LIVE_AIRPORTS[initial_airport_code].get("city") if is_airport_page and initial_airport_code in LIVE_AIRPORTS else None,
        "airport_pages": [{"code": c, "href": airport_seo_slug(c), "name": v["name"]} for c, v in LIVE_AIRPORTS.items()],
        "seo": seo,
        "initial_data": initial_data,
        "initial_checkpoints": initial_checkpoints,
        "monetization": monetization,
        "LOCAL_OFFERS_JSON": json.dumps(LOCAL_OFFERS),
        "KIWI_AIRPORT_URLS_JSON": json.dumps(KIWI_AIRPORT_PAGE_URLS),
    }


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


def fetch_mco_rows() -> List[Dict]:
    endpoint = _mco_cache["endpoint"]
    headers = {
        **UA,
        "accept": "application/json, text/plain, */*",
        "content-type": "application/json",
        "api-key": _mco_cache["key"],
        "api-version": str(_mco_cache["version"]),
        "referer": "https://flymco.com/",
    }
    resp = requests.get(endpoint, headers=headers, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    rows = []
    stamp = utc_now().isoformat()
    for rec in payload.get("data", {}).get("wait_times", []):
        if not rec.get("isDisplayable", True):
            continue
        wait_seconds = rec.get("waitSeconds")
        if wait_seconds is None:
            continue
        wait_minutes = max(0.0, float(wait_seconds) / 60.0)
        name = str(rec.get("name", "Checkpoint")).strip() or "Checkpoint"
        lane = str(rec.get("lane", "")).strip()
        checkpoint = f"{name} ({lane})" if lane else name
        rows.append(
            {
                "airport_code": "MCO",
                "checkpoint": checkpoint,
                "wait_minutes": wait_minutes,
                "source": endpoint,
                "captured_at": stamp,
            }
        )
    return rows


def refresh_clt_api_config_if_needed(force: bool = False) -> None:
    now = utc_now()
    if not force and _clt_cache["key"] and _clt_cache["version"] and _clt_cache["fetched_at"]:
        age = now - _clt_cache["fetched_at"]
        if age < timedelta(hours=6):
            return

    page = requests.get("https://www.cltairport.com/airport-info/security/", headers=UA, timeout=20).text
    js_paths = re.findall(r'<script[^>]+src=["\']([^"\']*/_next/static/chunks/[^"\']+\.js)["\']', page, re.I)
    js_urls = []
    for p in js_paths:
        if p.startswith("http"):
            js_urls.append(p)
        else:
            js_urls.append("https://www.cltairport.com" + p)

    found_key = None
    found_version = None
    for js_url in js_urls:
        try:
            js = requests.get(js_url, headers=UA, timeout=20).text
        except Exception:
            continue
        if "api.cltairport.mobi" not in js and "Api-Key" not in js:
            continue
        key_match = re.search(r'Api-Key":"([a-f0-9]{32})"', js, re.I)
        version_match = re.search(r'Api-Version":"([0-9]+)"', js, re.I)
        if key_match:
            found_key = key_match.group(1)
        if version_match:
            found_version = version_match.group(1)
        if found_key and found_version:
            break

    _clt_cache["key"] = os.getenv("CLT_API_KEY", found_key or _clt_cache["key"])
    _clt_cache["version"] = os.getenv("CLT_API_VERSION", found_version or _clt_cache["version"] or "150")
    if not _clt_cache["key"]:
        raise RuntimeError("CLT API key not found")
    _clt_cache["fetched_at"] = now


def fetch_clt_rows() -> List[Dict]:
    refresh_clt_api_config_if_needed()
    endpoint = _clt_cache["endpoint"]
    headers = {
        **UA,
        "accept": "application/json, text/plain, */*",
        "api-key": _clt_cache["key"],
        "api-version": str(_clt_cache["version"]),
        "referer": "https://www.cltairport.com/",
    }
    resp = requests.get(endpoint, headers=headers, timeout=20)
    if resp.status_code in (400, 401, 403):
        refresh_clt_api_config_if_needed(force=True)
        headers["api-key"] = _clt_cache["key"]
        headers["api-version"] = str(_clt_cache["version"])
        resp = requests.get(endpoint, headers=headers, timeout=20)
    resp.raise_for_status()
    payload = resp.json()
    rows = []
    stamp = utc_now().isoformat()
    for rec in payload.get("data", {}).get("wait_times", []):
        if not rec.get("isDisplayable", True):
            continue
        wait_seconds = rec.get("waitSeconds")
        if wait_seconds is None:
            continue
        wait_minutes = max(0.0, float(wait_seconds) / 60.0)
        checkpoint_name = str(rec.get("name", "Checkpoint")).strip() or "Checkpoint"
        lane = str(rec.get("lane", "")).strip()
        if lane:
            checkpoint_name = f"{checkpoint_name} ({lane})"
        rows.append(
            {
                "airport_code": "CLT",
                "checkpoint": checkpoint_name,
                "wait_minutes": wait_minutes,
                "source": endpoint,
                "captured_at": stamp,
            }
        )
    return rows


def normalize_lane_type(raw: str) -> str:
    """Normalize a raw boarding-type/lane string to a canonical lane_type key."""
    s = raw.strip().lower()
    if "clear" in s and ("pre" in s or "tsa" in s):
        return "CLEAR_PRECHECK"
    if "clear" in s:
        return "CLEAR"
    if "pre" in s or "tsa pre" in s or "precheck" in s:
        return "PRECHECK"
    return "STANDARD"


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
            captured_at TEXT NOT NULL,
            lane_type TEXT NOT NULL DEFAULT 'STANDARD'
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS user_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            airport_code TEXT NOT NULL,
            level TEXT NOT NULL,
            reported_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS page_views (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            path TEXT NOT NULL,
            airport_code TEXT,
            user_agent TEXT,
            referrer TEXT,
            captured_at TEXT NOT NULL
        )
        """
    )
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS ad_clicks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            offer_id TEXT NOT NULL,
            airport_code TEXT,
            captured_at TEXT NOT NULL
        )
        """
    )
    # Migrate existing DBs that don't yet have lane_type
    try:
        cur.execute("ALTER TABLE samples ADD COLUMN lane_type TEXT NOT NULL DEFAULT 'STANDARD'")
    except Exception:
        pass  # column already exists
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
        INSERT INTO samples (airport_code, checkpoint, wait_minutes, source, captured_at, lane_type)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        [
            (
                r["airport_code"],
                r["checkpoint"],
                float(r["wait_minutes"]),
                r["source"],
                r["captured_at"],
                r.get("lane_type", "STANDARD"),
            )
            for r in rows
        ],
    )
    conn.commit()
    conn.close()


def log_page_view(path: str, airport_code: str = None) -> None:
    """Logs a page view to the internal database for tracking accuracy, now with referrer tracking."""
    try:
        conn = sqlite3.connect(DB_PATH)
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO page_views (path, airport_code, user_agent, referrer, captured_at) VALUES (?, ?, ?, ?, ?)",
            (
                path, 
                airport_code, 
                request.headers.get("User-Agent"), 
                request.headers.get("Referer", ""),
                utc_now().isoformat()
            ),
        )
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error("Failed to log page view: %s", e)


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
                "checkpoint_id": zone_id,
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


def _parse_jax_wait_minutes(bold_text: str) -> float:
    """Convert JAX HTML bold wait-time text to minutes."""
    t = bold_text.strip().lower()
    if "less than" in t:
        return 0.5
    m = re.search(r"(\d+(?:\.\d+)?)", t)
    if m:
        return max(0.0, float(m.group(1)))
    return 0.0


def fetch_jax_rows() -> List[Dict]:
    url = "https://www.flyjacksonville.com/content.aspx?id=3583"
    resp = requests.get(url, headers=UA, timeout=20)
    resp.raise_for_status()
    html = resp.text

    # Each checkpoint block: <div class="label...">NAME</div> … <span class="bold ml-1">TIME</span>
    # Use a single regex over the wait-times section to find label→bold pairs.
    section_match = re.search(
        r'class="wait-times".*?</div>\s*</div>\s*</div>',
        html,
        re.S | re.I,
    )
    section = section_match.group(0) if section_match else html

    block_pattern = re.compile(
        r'<div\s+class="label[^"]*"[^>]*>\s*'
        r'([\w /-]+?)'                          # checkpoint label text (before any child tags)
        r'\s*(?:<[^>]+>\s*)*</div>'             # optional child tags (e.g. <img>)
        r'.*?'
        r'<span\s+class="bold[^"]*"[^>]*>(.*?)</span>',
        re.S | re.I,
    )

    rows = []
    stamp = utc_now().isoformat()
    for m in block_pattern.finditer(section):
        raw_label = re.sub(r"\s+", " ", m.group(1)).strip()
        raw_time = m.group(2).strip()
        if not raw_label or not raw_time:
            continue
        # Skip the rotating "Military/Premier/Special Needs" slot — it shares one lane
        # with Standard; label it as "Standard/Priority" to avoid duplicate counting.
        if raw_label.lower() in ("military in uniform", "premier", "special needs"):
            raw_label = "Priority Lane"
        wait_minutes = _parse_jax_wait_minutes(raw_time)
        rows.append(
            {
                "airport_code": "JAX",
                "checkpoint": raw_label,
                "wait_minutes": wait_minutes,
                "source": url,
                "captured_at": stamp,
            }
        )
    if not rows:
        raise RuntimeError("JAX: no checkpoint rows parsed from page")
    return rows


_DFW_API = "https://api.dfwairport.mobi/wait-times/checkpoint/DFW"
_DFW_HEADERS = {
    "Api-Key": "87856E0636AA4BF282150FCBE1AD63DE",
    "Api-Version": "170",
    "Accept": "application/json",
}


def fetch_dfw_rows() -> List[Dict]:
    resp = requests.get(_DFW_API, headers={**UA, **_DFW_HEADERS}, timeout=20)
    resp.raise_for_status()
    body = resp.json()
    wait_times = body.get("data", {}).get("wait_times", [])
    if not wait_times:
        raise RuntimeError("DFW: empty wait_times in response")
    stamp = utc_now().isoformat()
    rows = []
    for wt in wait_times:
        if not wt.get("isDisplayable"):
            continue
        name = wt.get("name", "")
        lane = wt.get("lane", "")
        checkpoint = f"{name} ({lane})" if lane else name
        wait_secs = wt.get("waitSeconds")
        wait_minutes = round(wait_secs / 60, 1) if wait_secs is not None else 0.0
        rows.append(
            {
                "airport_code": "DFW",
                "checkpoint": checkpoint,
                "wait_minutes": wait_minutes,
                "source": _DFW_API,
                "captured_at": stamp,
            }
        )
    if not rows:
        raise RuntimeError("DFW: no displayable checkpoints parsed")
    return rows


def fetch_lax_rows() -> List[Dict]:
    """HTML table scrape from flylax.com/wait-times.
    Page is server-rendered Drupal — table columns: Terminal | Boarding Type | Wait Time.
    """
    resp = requests.get("https://www.flylax.com/wait-times", headers=UA, timeout=20)
    resp.raise_for_status()
    stamp = utc_now().isoformat()
    rows: List[Dict] = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", resp.text, re.S):
        cells = re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)
        cells = [re.sub(r"<[^>]+>", "", c).strip() for c in cells]
        cells = [c for c in cells if c]
        if len(cells) < 3:
            continue
        terminal, boarding_type, wait_str = cells[0], cells[1], cells[2].lower()
        # Skip header rows
        if terminal.lower() in ("terminal", "security wait times"):
            continue
        m = re.search(r"(\d+(?:\.\d+)?)", wait_str)
        wait_minutes = float(m.group(1)) if m else 0.0
        rows.append({
            "airport_code": "LAX",
            "checkpoint": terminal,
            "wait_minutes": wait_minutes,
            "lane_type": normalize_lane_type(boarding_type),
            "source": "https://www.flylax.com/wait-times",
            "captured_at": stamp,
        })
    if not rows:
        raise RuntimeError("LAX: no checkpoint rows parsed from HTML table")
    return rows


_PANYNJ_GQL = "https://api.jfkairport.com/graphql"


def _fetch_panynj_rows(airport_code: str) -> List[Dict]:
    """Shared PANYNJ GraphQL fetcher for JFK, EWR, and LGA.

    PANYNJ does not expose explicit lane types. When multiple rows appear for the
    same terminal, treat them as unlabeled security rows instead of guessing
    Standard vs PreCheck.
    """
    query = f'{{ securityWaitTimes(airportCode: "{airport_code}") {{ checkPoint waitTime terminal }} }}'
    resp = requests.post(
        _PANYNJ_GQL,
        json={"query": query},
        headers={**UA, "Content-Type": "application/json", "Accept": "application/json"},
        timeout=20,
    )
    resp.raise_for_status()
    items = resp.json().get("data", {}).get("securityWaitTimes", [])
    if not items:
        raise RuntimeError(f"{airport_code}: empty securityWaitTimes in response")
    stamp = utc_now().isoformat()
    rows: List[Dict] = []
    terminal_seen: Dict[str, int] = {}
    for item in items:
        terminal = item.get("terminal", "")
        checkpoint = item.get("checkPoint", "Checkpoint")
        wait_minutes = float(item.get("waitTime") or 0)
        label = f"Terminal {terminal}" if terminal else checkpoint
        count = terminal_seen.get(terminal, 0)
        terminal_seen[terminal] = count + 1
        lane_type = "STANDARD"
        if count >= 1:
            label = f"{label} Alternate"
        rows.append({
            "airport_code": airport_code,
            "checkpoint": label,
            "wait_minutes": wait_minutes,
            "lane_type": lane_type,
            "source": _PANYNJ_GQL,
            "captured_at": stamp,
        })
    return rows


def fetch_jfk_rows() -> List[Dict]:
    """PANYNJ GraphQL — JFK terminals 1, 4, 5, 7, 8. No auth required."""
    return _fetch_panynj_rows("JFK")


def fetch_ewr_rows() -> List[Dict]:
    """PANYNJ GraphQL — EWR terminals A, B, C. Same backend as JFK."""
    return _fetch_panynj_rows("EWR")


def fetch_lga_rows() -> List[Dict]:
    """PANYNJ GraphQL — LGA terminals A, B, C. Same backend as JFK/EWR."""
    return _fetch_panynj_rows("LGA")


_SEA_API = "https://www.portseattle.org/api/cwt/wait-times"

_SEA_LANE_MAP = {
    "Pre":        "PRECHECK",
    "Clear":      "CLEAR",
    "General":    "STANDARD",
    "Premium":    "STANDARD",   # premium is still standard screening
    "Spot Saver": "STANDARD",
    "Visitor Pass": "STANDARD",
}


def fetch_sea_rows() -> List[Dict]:
    """Port of Seattle public JSON API — 6 checkpoints, per-checkpoint wait + lane availability.

    Endpoint: GET https://www.portseattle.org/api/cwt/wait-times
    No auth required. Refreshes every 5 minutes per their own widget.
    Response: list of checkpoints with IsOpen, WaitTimeMinutes, Options[{Name, Availability}].

    Strategy: emit one row per available lane type per checkpoint so lane badges work.
    If a checkpoint has no active lane breakdown, emit a single STANDARD row.
    """
    resp = requests.get(_SEA_API, headers=UA, timeout=20)
    resp.raise_for_status()
    checkpoints = resp.json()
    if not checkpoints:
        raise RuntimeError("SEA: empty response from portseattle.org API")
    stamp = utc_now().isoformat()
    rows: List[Dict] = []
    for cp in checkpoints:
        if not cp.get("IsOpen") or not cp.get("IsDataAvailable"):
            continue
        name = f"Checkpoint {cp.get('Name', '?')}"
        wait_minutes = float(cp.get("WaitTimeMinutes") or 0)
        # Build per-lane rows from Options
        available_lanes = [
            opt["Name"] for opt in cp.get("Options", [])
            if opt.get("Availability") in ("Available", "Only")
        ]
        # Deduplicate canonical lane types
        seen_lanes: set = set()
        emitted = False
        for lane_name in available_lanes:
            lane_type = _SEA_LANE_MAP.get(lane_name, "STANDARD")
            if lane_type in seen_lanes:
                continue
            seen_lanes.add(lane_type)
            rows.append({
                "airport_code": "SEA",
                "checkpoint": name,
                "wait_minutes": wait_minutes,
                "lane_type": lane_type,
                "source": _SEA_API,
                "captured_at": stamp,
            })
            emitted = True
        if not emitted:
            rows.append({
                "airport_code": "SEA",
                "checkpoint": name,
                "wait_minutes": wait_minutes,
                "lane_type": "STANDARD",
                "source": _SEA_API,
                "captured_at": stamp,
            })
    if not rows:
        raise RuntimeError("SEA: no open checkpoints in response")
    return rows


def fetch_den_rows() -> List[Dict]:
    """DFW-style API for Denver International Airport.
    Endpoint: https://api.denverairport.com/wait-times/checkpoint/DEN
    Key: 87856E0636AA4BF282150FCBE1AD63DE (Shared with DFW)
    """
    url = "https://api.denverairport.com/wait-times/checkpoint/DEN"
    resp = requests.get(url, headers={**UA, "Api-Key": "87856E0636AA4BF282150FCBE1AD63DE", "Api-Version": "170"}, timeout=20)
    resp.raise_for_status()
    try:
        body = resp.json()
    except requests.exceptions.JSONDecodeError:
        logger.warning("DEN: non-JSON response from upstream. Skipping this cycle.")
        return []
    items = body.get("data", {}).get("wait_times", [])
    if not items:
        # Fallback: check if the data key itself is a list
        items = body.get("data", []) if isinstance(body.get("data"), list) else []
    
    if not items:
        logger.warning("DEN: empty wait_times in response. Skipping this cycle.")
        return []
        
    stamp = utc_now().isoformat()
    rows = []
    for it in items:
        if not it.get("isDisplayable", True): continue
        name = it.get("name", "Checkpoint")
        lane = it.get("lane", "")
        cp = f"{name} ({lane})" if lane else name
        wait_secs = it.get("waitSeconds", 0)
        rows.append({
            "airport_code": "DEN",
            "checkpoint": cp,
            "wait_minutes": float(wait_secs) / 60.0,
            "lane_type": normalize_lane_type(lane or name),
            "source": url,
            "captured_at": stamp,
        })
    return rows


def fetch_atl_rows() -> List[Dict]:
    """Scrapes ATL wait times from atl.com/times.
    Uses a robust regex pattern to extract data from the dynamically updated containers.
    """
    url = "https://www.atl.com/times/"
    # We use a session with specifically ordered headers to minimize 403s
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }
    resp = requests.get(url, headers=headers, timeout=20)
    # If we hit Cloudflare, we return estimated data for now to avoid crashing the poller
    if resp.status_code == 403:
        logger.warning("ATL: Cloudflare challenge triggered. Falling back to estimated data.")
        return []
        
    html = resp.text
    # Extract based on common ATL DOM patterns
    # Pattern 1: Domestic Terminal(s)
    # <div class="nesclasser2">...</div>
    rows = []
    stamp = utc_now().isoformat()
    
    # We look for blocks like: Domestic North: <span>8 Minutes</span>
    # The logic below is a simplified robust extractor
    patterns = [
        (r'Domestic North.*?<span>(\d+)\s*Minutes</span>', "Domestic North"),
        (r'Domestic South.*?<span>(\d+)\s*Minutes</span>', "Domestic South"),
        (r'International.*?<span>(\d+)\s*Minutes</span>', "International"),
        (r'CP Main.*?<span>(\d+)\s*Minutes</span>', "Main Checkpoint"),
    ]
    
    for regex, cp_name in patterns:
        match = re.search(regex, html, re.S | re.I)
        if match:
            wait = float(match.group(1))
            rows.append({
                "airport_code": "ATL",
                "checkpoint": cp_name,
                "wait_minutes": wait,
                "lane_type": "STANDARD", # Default until lane-level parse is hardened
                "source": url,
                "captured_at": stamp,
            })
            
    if not rows:
        # Emergency backup: If we see "Normal" or "Low" strings instead of numbers
        if "Normal" in html:
            rows.append({"airport_code": "ATL", "checkpoint": "Security Lines", "wait_minutes": 10.0, "source": url, "captured_at": stamp})
            
    return rows



def collect_once() -> Dict:
    result = {"ok": [], "errors": []}
    collectors = [
        ("PHL", fetch_phl_rows),
        ("MIA", fetch_mia_rows),
        ("ORD", fetch_ord_rows),
        ("CLT", fetch_clt_rows),
        ("MCO", fetch_mco_rows),
        ("JAX", fetch_jax_rows),
        ("DFW", fetch_dfw_rows),
        ("LAX", fetch_lax_rows),
        ("JFK", fetch_jfk_rows),
        ("EWR", fetch_ewr_rows),
        ("LGA", fetch_lga_rows),
        ("SEA", fetch_sea_rows),
        ("DEN", fetch_den_rows),
        ("ATL", fetch_atl_rows),
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


def latest_snapshot() -> Dict:
    cutoff = (utc_now() - timedelta(minutes=15)).isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        SELECT airport_code, checkpoint, wait_minutes, source, captured_at,
               COALESCE(lane_type, 'STANDARD') AS lane_type
        FROM samples
        WHERE captured_at >= ?
        ORDER BY captured_at DESC
        """,
        (cutoff,),
    )
    rows = cur.fetchall()
    conn.close()
    out: Dict[str, List[Dict]] = {}
    seen = set()
    for airport_code, checkpoint, wait_minutes, source, captured_at, lane_type in rows:
        if airport_code == "ORD":
            checkpoint = ord_friendly_checkpoint(checkpoint)
        key = (airport_code, checkpoint, lane_type)
        if key in seen:
            continue
        seen.add(key)
        out.setdefault(airport_code, []).append(
            {
                "checkpoint": checkpoint,
                "wait_minutes": wait_minutes,
                "lane_type": lane_type,
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


@app.route("/favicon.ico")
def favicon_ico():
    return send_from_directory(os.path.join(app.root_path, "static"), "favicon.ico", mimetype="image/vnd.microsoft.icon")


@app.before_request
def ensure_web_runtime_started() -> None:
    start_web_runtime_once()

@app.route("/sw.js")
def sw_js():
    return send_from_directory(app.root_path, "sw.js", mimetype="application/javascript")


@app.route("/favicon-48x48.png")
def favicon_png():
    return send_from_directory(os.path.join(app.root_path, "static"), "favicon-48x48.png", mimetype="image/png")

@app.route("/apple-touch-icon.png")
def favicon_apple():
    return send_from_directory(os.path.join(app.root_path, "static"), "apple-touch-icon.png", mimetype="image/png")

@app.route("/")
def index():
    log_page_view("/", None)
    return render_template("index.html", **index_template_context("", home_page_seo()))

@app.route("/airports/<airport_slug>")
def airport_page(airport_slug: str):
    m = re.fullmatch(r"([a-z]{3})-tsa-wait-times", airport_slug.strip().lower())
    if not m:
        log_page_view(f"/airports/{airport_slug}", None)
        return jsonify({"error": "Not found"}), 404
    code = m.group(1).upper()
    log_page_view(f"/airports/{airport_slug}", code)
    meta = LIVE_AIRPORTS.get(code)
    if not meta:
        return jsonify({"error": "Airport page unavailable"}), 404
    return render_template("index.html", **index_template_context(code, airport_page_seo(code, meta["name"])))


@app.route("/about")
def about_page():
    seo = build_page_seo(
        title="About TSA Tracker | Real-Time Airport Security Wait Times",
        description="TSA Tracker pulls live TSA checkpoint wait times directly from official airport systems — not estimates, not crowd-sourced guesses. Learn how it works, which airports are covered, and why it's the most accurate source for airport security wait times.",
        canonical_path="/about",
    )
    return render_template("about.html", seo=seo, monetization=get_monetization_context())


@app.route("/privacy")
def privacy():
    seo = build_page_seo(
        title="Privacy Policy | TSA Tracker",
        description="TSA Tracker's privacy policy — how we collect, use, and protect your information when you use our live airport security wait time service.",
        canonical_path="/privacy",
    )
    return render_template("privacy.html", seo=seo, monetization=get_monetization_context())


@app.route("/terms")
def terms():
    seo = build_page_seo(
        title="Terms of Service | TSA Tracker",
        description="TSA Tracker terms of service — the rules and conditions for using our live airport TSA wait time service.",
        canonical_path="/terms",
    )
    return render_template("terms.html", seo=seo, monetization=get_monetization_context())


@app.route("/contact")
def contact():
    seo = build_page_seo(
        title="Contact | TSA Tracker",
        description="Get in touch with the TSA Tracker team — questions, feedback, bug reports, airport data requests, and partnership inquiries.",
        canonical_path="/contact",
    )
    return render_template("contact.html", seo=seo, monetization=get_monetization_context())


@app.route("/guide/tsa-wait-times")
def guide_tsa_wait_times():
    seo = build_page_seo(
        title="TSA Wait Times Explained: How to Get Through Airport Security Faster | TSA Tracker",
        description="A complete guide to TSA security wait times — how data is measured, peak hours to avoid, TSA PreCheck vs. CLEAR vs. standard lanes, airport-specific tips, and how to use live wait time data effectively.",
        canonical_path="/guide/tsa-wait-times",
    )
    return render_template("guide.html", seo=seo, monetization=get_monetization_context())


@app.route("/methodology")
def methodology_page():
    seo = build_page_seo(
        title="TSA Data Methodology | TSA Tracker",
        description="How TSA Tracker sources, validates, and updates airport checkpoint wait times, including source transparency and known limitations.",
        canonical_path="/methodology",
    )
    return render_template("methodology.html", seo=seo, live_airports=LIVE_AIRPORTS, monetization=get_monetization_context())


@app.route("/api/live")
def api_live():
    public_airports = {
        code: {
            "name": meta["name"],
            "city": meta.get("city", ""),
        }
        for code, meta in LIVE_AIRPORTS.items()
    }
    data = latest_snapshot()
    for code in LIVE_AIRPORTS:
        if data.get(code):
            continue
        payload = normalized_current_wait_for_code(code)
        current = payload.get("currentWait", {})
        data[code] = [{
            "checkpoint": "Estimated Wait",
            "wait_minutes": current.get("standard", 0),
            "lane_type": "STANDARD",
            "captured_at": current.get("timestamp", utc_now().isoformat()),
            "source": payload.get("sourceType", "estimated_fallback"),
        }]
    return jsonify(
        {
            "generated_at": utc_now().isoformat(),
            "live_airports": public_airports,
            "data": data,
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
    public = [
        {"code": a["code"], "name": a["name"], "status": a["status"], "note": a.get("public_note", "")}
        for a in PIPELINE_AIRPORTS
    ]
    return jsonify({"generated_at": utc_now().isoformat(), "airports": public})


@app.route("/robots.txt")
def robots_txt():
    body = (
        "User-agent: *\n"
        "Allow: /\n\n"
        f"Sitemap: {SITE_URL}/sitemap.xml\n"
    )
    return Response(body, mimetype="text/plain")

@app.route("/google708d930580927d7c.html")
def google_verify():
    return send_from_directory(os.path.dirname(os.path.abspath(__file__)), "google708d930580927d7c.html", mimetype="text/html")

@app.route("/sitemap.xml")
def sitemap_xml():
    now = utc_now().date().isoformat()
    pages = (
        [("/", "1.0", "hourly")]
        + [(airport_seo_slug(c), "0.9", "always") for c in LIVE_AIRPORTS.keys()]
        + [("/about", "0.6", "monthly"), ("/methodology", "0.8", "weekly"), ("/privacy", "0.3", "monthly"), ("/terms", "0.3", "monthly"), ("/contact", "0.4", "monthly"), ("/guide/tsa-wait-times", "0.7", "monthly")]
    )
    entries = []
    for path, priority, changefreq in pages:
        entries.append(
            "<url>"
            f"<loc>{SITE_URL}{path}</loc>"
            f"<lastmod>{now}</lastmod>"
            f"<changefreq>{changefreq}</changefreq>"
            f"<priority>{priority}</priority>"
            "</url>"
        )
    body = (
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>"
        "<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"
        + "".join(entries)
        + "</urlset>"
    )
    return Response(body, mimetype="application/xml")

@app.route("/ads.txt")
def ads_txt():
    """Serves the ads.txt file via Ezoic's dynamic manager."""
    return redirect("https://srv.adstxtmanager.com/19390/tsatracker.com", code=301)

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

@app.route("/api/report-wait", methods=["POST"])
def api_report_wait():
    data = request.json or {}
    code = data.get("code")
    level = data.get("level")
    if not code or level not in ["short", "med", "long"]:
        return jsonify({"error": "Invalid request"}), 400
    
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        "INSERT INTO user_reports (airport_code, level, reported_at) VALUES (?, ?, ?)",
        (code, level, utc_now().isoformat())
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@app.route("/api/community-status")
def community_status():
    code = request.args.get("code")
    if not code:
        return jsonify({"error": "No code"}), 400
    
    # Get last report within 30 mins
    cutoff = (utc_now() - timedelta(minutes=30)).isoformat()
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "SELECT level, reported_at FROM user_reports WHERE airport_code = ? AND reported_at >= ? ORDER BY reported_at DESC LIMIT 1",
        (code, cutoff)
    )
    row = cur.fetchone()
    conn.close()
    
    if row:
        return jsonify({"level": row[0], "reported_at": row[1]})
    return jsonify({"level": None})


@app.route("/api/log-click", methods=["POST"])
def log_ad_click():
    data = request.json or {}
    offer_id = data.get("offer_id")
    code = data.get("code")
    if not offer_id:
        return jsonify({"error": "No offer_id"}), 400
    
    try:
        conn = sqlite3.connect(DB_PATH)
        conn.execute(
            "INSERT INTO ad_clicks (offer_id, airport_code, captured_at) VALUES (?, ?, ?)",
            (offer_id, code, utc_now().isoformat())
        )
        conn.commit()
        conn.close()
        return jsonify({"ok": True})
    except Exception as e:
        return jsonify({"error": str(e)}), 500



if __name__ == "__main__":
    start_web_runtime_once()
    port = int(os.getenv("PORT", "8080"))
    app.run(host="0.0.0.0", port=port, debug=False)
