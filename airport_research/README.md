# Airport Research Notes

Reference for every airport we've investigated — how we get live TSA wait data, what auth is involved, and what's still blocked.

---

## Status Overview

| Code | Name | Status | Auth |
|------|------|--------|------|
| PHL | Philadelphia International | ✅ Live | Public |
| MIA | Miami International | ✅ Live | Rotating key (scraped from JS) |
| ORD | Chicago O'Hare | ✅ Live | Public |
| CLT | Charlotte Douglas | ✅ Live | Rotating key (scraped from JS) |
| MCO | Orlando International | ✅ Live | Static key (env / bundle) |
| JAX | Jacksonville International | ✅ Live | Public |
| DFW | Dallas/Fort Worth | ✅ Live | Static key (embedded in bundle) |
| ATL | Hartsfield-Jackson Atlanta | 🔬 Research | Cloudflare-blocked |
| DEN | Denver International | 🔬 Research | Cloudflare-blocked |

---

## Notes Structure

```
airport_research/
  live/       — fully integrated airports
  pipeline/   — airports still under investigation
```

Each file records: endpoint URL, required headers/auth, key refresh strategy (if any), response schema, and any gotchas.
