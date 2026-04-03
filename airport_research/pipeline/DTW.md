# DTW — Detroit Metropolitan Airport

**Status:** 🔬 In Research  
**Pipeline status:** `IN_RESEARCH`  
**Last investigated:** 2026-03-23  

---

## Target URL

`https://www.metroairport.com/at-the-airport/security`

---

## Investigation Log

### Pass 1 (2026-03-23 — static scan)

`metroairport.com/at-the-airport/security` returns HTTP 200 with server-rendered HTML. The actual wait-time data is **not present in the static HTML** — it is loaded dynamically via JavaScript/AJAX.

Key findings:
- Page contains security-related content
- No JSON API key extraction possible
- No skydive/mobi API domain exists
- No standard REST or GraphQL endpoint found
- Wait time data fetched via client-side JS

### Pass 2 (2026-03-23 — API pattern probes)

Tested common endpoint patterns:
- `https://api.metroairport.com/wait-times` → 404
- `https://www.metroairport.com/api/wait-times` → 404
- No GraphQL endpoint detected

---

## Most Promising Lead

**Dynamic client-side rendering via XHR**

Requires headless browser automation to discover actual API endpoints.

---

## Next Steps

1. **Headless browser capture** — Monitor XHR requests
2. **Check for vendor widgets**
3. **Re-probe if airport launches public API**

---

## Notes

- Part of batch onboarding (IAH, LAS, BWI, DTW, IAD, DCA) on 2026-03-23
