# ATL — Hartsfield-Jackson Atlanta International Airport

**Status:** 🔬 In Research  
**Pipeline status:** `IN_RESEARCH`  

---

## Target URL

`https://www.atl.com/times/`

---

## What We Tried (2026-03-22)

### Static scan (curl + Python)

All requests to `atl.com` return **HTTP 403** with a Cloudflare challenge:

```
cf-mitigated: challenge
server: cloudflare
```

This applies to:
- `https://www.atl.com/times/` (main page)
- `https://www.atl.com/api/wait-times`
- `https://www.atl.com/wp-json/atl/v1/times`
- `https://www.atl.com/wp-admin/admin-ajax.php`

Even with full browser-like headers (Sec-CH-UA, Sec-Fetch-*, etc.) the challenge fires.

### TSA DHS endpoint

`https://apps.tsa.dhs.gov/mytsa/wait_times_detail.aspx?airport=ATL` — returns 200 but is the generic MyTSA mobile app marketing page, not actual live wait time data (same 75KB HTML regardless of airport code).

### Other services

No publicly accessible API found via common airport/wait-time patterns.

---

## What's Needed to Unblock

One of the following:
1. **Headless browser session** (Playwright with Chromium) to pass the Cloudflare Turnstile challenge, then capture the real API calls in network traffic.
2. **Alternative data source** — check if ATL uses a known third-party service (LocustLabs, Elerts, waittime.api.aero, etc.) that has a non-Cloudflare endpoint.
3. **Direct partnership/API key** from ATL.

---

## Notes

- ATL is the world's busiest airport — high-value addition.
- `AIRPORT_FACTORS["ATL"] = 1.25` is already set for forecast scaling.
- ATL likely uses a modern Next.js or React-based site. Once the Cloudflare challenge is bypassed, look for a `/_next/data/` API call or a React app config with an embedded API key (same approach as DFW).
