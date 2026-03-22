# PHL — Philadelphia International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_PUBLIC`  
**Onboarded:** Pre-existing  

---

## Endpoint

```
GET https://www.phl.org/phllivereach/metrics
```

**Auth:** None — fully public, no key or session required.  
**Headers:** Standard `User-Agent` only.

---

## Response Schema

Returns a JSON object with a `content.rows` array. Each row is a list where:
- `row[0]` — zone ID (string)
- `row[1]` — wait time in **minutes** (float)

### Zone ID → Checkpoint Map

| Zone ID | Checkpoint Name |
|---------|----------------|
| `4126` | D/E TSA PreCheck |
| `3971` | D/E General |
| `4377` | A-West General |
| `4386` | A-East TSA PreCheck |
| `4368` | A-East General |
| `5047` | B General |
| `5052` | C General |
| `5068` | F General |

Rows with zone IDs not in this map are silently ignored.

---

## Notes

- No auth, no rotating key — simplest possible integration.
- Wait times are already in minutes (floats), no conversion needed.
- Typically returns 8 rows.
