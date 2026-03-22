# MIA — Miami International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_KEY_REQUIRED`  
**Onboarded:** Pre-existing  

---

## Endpoint

Endpoint URL and API key are **scraped dynamically** from the MIA wait-times JS bundle — they rotate and cannot be hardcoded.

**Discovery page:** `https://www.miami-airport.com/tsa-waittimes.asp`  
**Bundle pattern scraped:** `js/wait-times/main*.js` (referenced in page `<script>` tags)  
**Endpoint regex:** `https://waittime\.api\.aero/waittime/v2/current/[A-Z]+`  
**Key regex:** `x-apikey\s*:\s*"([a-f0-9]{20,})"`

At runtime the endpoint resolves to something like:
```
GET https://waittime.api.aero/waittime/v2/current/MIA
```

**Auth header:** `x-apikey: <rotating key from bundle>`

---

## Key Refresh Strategy

- Refreshed on first call and then cached for **1 hour** (`timedelta(hours=1)`).
- On a `403` response, forces an immediate re-scrape before retrying.
- Controlled by `_mia_cache` dict and `refresh_mia_api_key_if_needed()`.

---

## Response Schema

Returns a JSON object with a `current` array. Each item:

| Field | Type | Notes |
|-------|------|-------|
| `queueName` | string | Checkpoint display name |
| `status` | string | `"open"` or other — non-open rows skipped |
| `projectedMinWaitMinutes` | float | Lower bound |
| `projectedMaxWaitMinutes` | float | Upper bound |
| `projectedWaitTime` | float | Fallback if min/max absent |

Wait time stored as average of min+max when both present.

---

## Notes

- Key rotates frequently — do not hardcode. The scrape is lightweight (one page fetch + one JS fetch).
- Typically returns ~5 rows.
- `waittime.api.aero` is a third-party queuing service used by multiple airports.
