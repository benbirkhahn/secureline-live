# IAD — Washington Dulles International Airport

**Status:** 🔬 In Research  
**Pipeline status:** `IN_RESEARCH`  
**Last investigated:** 2026-03-23  

---

## Target URLs

- `https://www.flydulles.com/iad/security-checkpoints`
- `https://mwaa.com` (MWAA operates both IAD and DCA)

---

## Investigation Log

### Pass 1 (2026-03-23 — static scan)

Both `flydulles.com` and `mwaa.com` return HTTP 200 with server-rendered HTML. The actual wait-time data is **not present in the static HTML** — it is loaded dynamically via JavaScript/AJAX.

Key findings:
- IAD and DCA share the same operator: MWAA (Metropolitan Washington Airports Authority)
- Both airports likely share a backend wait-time system
- No JSON API key extraction possible
- No skydive/mobi API domain exists
- No standard REST or GraphQL endpoint found
- Wait time data fetched via client-side JS

### Pass 2 (2026-03-23 — API pattern probes)

Tested common endpoint patterns:
- `https://api.mwaa.com/wait-times` → 404
- `https://api.flydulles.com/wait-times` → 404
- `https://www.flydulles.com/api/wait-times` → 404
- No GraphQL endpoint detected

---

## Most Promising Lead

**MWAA shared backend**

Both IAD and DCA are operated by MWAA, suggesting they may eventually expose a unified wait-time API. Currently both render wait times dynamically client-side.

**Dynamic client-side rendering via XHR**

Requires headless browser automation to discover actual API endpoints.

---

## Next Steps

1. **Headless browser capture** — Monitor XHR requests on both flydulles.com and mwaa.com
2. **Check for shared MWAA API** — Once discovered for one airport, may apply to both
3. **Re-probe periodically** — MWAA may launch public API

---

## Notes

- Part of batch onboarding (IAH, LAS, BWI, DTW, IAD, DCA) on 2026-03-23
- **Linked airport:** DCA (same MWAA operator)
