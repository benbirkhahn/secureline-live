# BWI — Baltimore/Washington International Airport

**Status:** 🔬 In Research  
**Pipeline status:** `IN_RESEARCH`  
**Last investigated:** 2026-03-23  

---

## Target URL

`https://www.bwiairport.com/at-bwi/airport-security`

---

## Investigation Log

### Pass 1 (2026-03-23 — static scan)

`bwiairport.com/at-bwi/airport-security` returns HTTP 200 with server-rendered HTML. The actual wait-time data is **not present in the static HTML** — it is loaded dynamically via JavaScript/AJAX.

Key findings:
- Page contains security information and guidelines
- No JSON API key extraction possible
- No skydive/mobi API domain exists
- No standard REST or GraphQL endpoint found
- Wait time data fetched via client-side JS

### Pass 2 (2026-03-23 — API pattern probes)

Tested common endpoint patterns:
- `https://api.bwiairport.com/wait-times` → 404
- `https://www.bwiairport.com/api/wait-times` → 404
- No GraphQL endpoint detected

---

## Most Promising Lead

**Dynamic client-side rendering via XHR**

The page loads wait-time data after initial HTML render. Requires headless browser to intercept network requests.

---

## Next Steps

1. **Headless browser capture** — Use Playwright to monitor XHR while page loads
2. **Check for embedded vendor widgets**
3. **Re-probe if airport launches public API**

---

## Notes

- Part of batch onboarding (IAH, LAS, BWI, DTW, IAD, DCA) on 2026-03-23
