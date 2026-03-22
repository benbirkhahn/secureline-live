# CLT — Charlotte Douglas International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_KEY_REQUIRED`  
**Onboarded:** Pre-existing  

---

## Endpoint

```
GET https://api.cltairport.mobi/wait-times/checkpoint/CLT
```

This URL is stable/hardcoded. The **API key and version** rotate and are scraped dynamically.

---

## Auth

**Headers required:**
```
Api-Key: <rotating key>
Api-Version: <rotating version>
```

Key and version are scraped from CLT's Next.js JS bundle every **6 hours**.

**Discovery page:** `https://www.cltairport.com/airport-info/security/`  
**Bundle pattern:** `/_next/static/chunks/*.js` files referenced in the page  
**Key regex:** `Api-Key":"([a-f0-9]{32})"`  
**Version regex:** `Api-Version":"([0-9]+)"`

Can also be overridden via env vars `CLT_API_KEY` and `CLT_API_VERSION`.

---

## Key Refresh Strategy

- Refreshed on first call and cached for **6 hours** (`timedelta(hours=6)`).
- On a `400`, `401`, or `403` response, forces an immediate re-scrape before retrying once.
- Controlled by `_clt_cache` dict and `refresh_clt_api_config_if_needed()`.

---

## Response Schema

```json
{
  "data": {
    "wait_times": [
      {
        "name": "A1",
        "lane": "General",
        "isOpen": true,
        "isDisplayable": true,
        "waitSeconds": 180
      }
    ]
  }
}
```

- Skip rows where `isDisplayable` is false.
- Convert `waitSeconds` → minutes.
- Checkpoint label: `"{name} ({lane})"` or just `name` if no lane.

---

## Notes

- Uses the same `api.cltairport.mobi` / skydive backend as MCO and DFW.
- Typically returns ~4 rows.
- Key rotation interval appears to be days to weeks, but 6-hour re-scrape is safe.
