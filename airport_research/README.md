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
| EWR | Newark Liberty International | ✅ Live | Public (GraphQL, PANYNJ) |
| LGA | LaGuardia Airport | ✅ Live | Public (GraphQL, PANYNJ) |
| SEA | Seattle-Tacoma International | ✅ Live | Public (Drupal JSON API, portseattle.org) |
| ATL | Hartsfield-Jackson Atlanta | 🔬 Research | Cloudflare-blocked (all paths) |
| DEN | Denver International | 🔬 Research | 403 Forbidden on direct probe |
| IAH | Houston Intercontinental | 🔬 Research | Live data confirmed via TTT; Next.js API endpoint not yet found |
| DTW | Detroit Metro | 🔬 Research | Live data confirmed via TTT; metroairport.com Drupal endpoint not yet found |
| DCA | Reagan National | 🔬 Research | Live data confirmed via TTT; flyreagan.com endpoint not yet found |
| SFO | San Francisco International | 🔬 Research | Wait times page exists but data is JS-rendered |

---

## Notes Structure

```
airport_research/
  live/       — fully integrated airports
  pipeline/   — airports still under investigation
```

Each file records: endpoint URL, required headers/auth, key refresh strategy (if any), response schema, and any gotchas.
