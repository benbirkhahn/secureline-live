# ORD — Chicago O'Hare International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_PUBLIC`  
**Onboarded:** Pre-existing  

---

## Endpoint

```
GET https://tsawaittimes.flychicago.com/tsawaittimes
```

**Auth:** None — fully public JSON API run by the Chicago Department of Aviation.  
**Headers:** Standard `User-Agent` only.

---

## Response Schema

Returns a JSON **array** of checkpoint objects. Each item:

| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Raw checkpoint name (e.g. `"Terminal 1 - Checkpoint 1"`) |
| `waitTimes` | number | Wait time in **seconds** |

- Divide `waitTimes` by 60 to get minutes.
- Values `>= 400000` are sentinel "invalid" values — skip them.
- Checkpoint names are normalized via `ord_friendly_checkpoint()` helper.

---

## Notes

- Typically returns ~10 rows covering Terminals 1, 2, 3, and 5.
- Very stable endpoint — has been unchanged for years.
- No auth, no rotating key, no Cloudflare.
