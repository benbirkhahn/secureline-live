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
| LAX | Los Angeles International | ✅ Live | Public (HTML table scrape) |
| JFK | John F. Kennedy International | ✅ Live | Public (GraphQL, PANYNJ) |
| ATL | Hartsfield-Jackson Atlanta | 🔬 Research | Cloudflare-blocked (all paths) |
| DEN | Denver International | 🔬 Research | API middleware found; upstream not yet configured |
| SEA | Seattle-Tacoma International | 🔬 Research | No public endpoint; seaspotsaver.com unreachable |
| SFO | San Francisco International | 🔬 Research | Wait times page exists but data is JS-rendered |

---

## Notes Structure

```
airport_research/
  live/       — fully integrated airports
  pipeline/   — airports still under investigation
```

Each file records: endpoint URL, required headers/auth, key refresh strategy (if any), response schema, and any gotchas.
