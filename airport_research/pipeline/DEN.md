# DEN — Denver International Airport

**Status:** 🔬 In Research  
**Pipeline status:** `IN_RESEARCH`  

---

## Target URL

`https://www.flydenver.com/airport/securities`

---

## What We Tried (2026-03-22)

### Static scan (curl + Python)

All requests to `flydenver.com` return **HTTP 403** with a Cloudflare challenge. This applies to:
- `https://www.flydenver.com/airport/securities` (main target)
- `https://www.flydenver.com/api/security`
- `https://www.flydenver.com/api/wait-times`
- `https://www.flydenver.com/airport/securities.json`
- `https://www.flydenver.com/wp-json/den/v1/security`

Even with full browser-like headers the Cloudflare challenge fires (same behaviour as ATL).

### TSA DHS endpoint

`https://apps.tsa.dhs.gov/mytsa/wait_times_detail.aspx?airport=DEN` — same generic MyTSA marketing page as ATL, not real data.

---

## What's Needed to Unblock

One of the following:
1. **Headless browser session** (Playwright with Chromium) to pass the Cloudflare challenge, then capture real API network calls.
2. **Alternative data source** — check if DEN uses a known third-party service (LocustLabs, Elerts, waittime.api.aero, etc.) accessible without Cloudflare.
3. **Direct partnership/API key** from DEN/Jeppesen.

---

## Notes

- `AIRPORT_FACTORS["DEN"] = 1.15` already set for forecast scaling.
- DEN site (`flydenver.com`) appears to be a Drupal or similar CMS site. Once Cloudflare is bypassed, look for a REST or JSON:API endpoint. Drupal typically exposes data at `/jsonapi/` or `/api/`.
- DEN is a major hub (United) — worth prioritizing once a Playwright-capable environment is available.
