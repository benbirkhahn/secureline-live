# IAH — George Bush Intercontinental Airport

**Status:** 🔬 In Research  
**Pipeline status:** `IN_RESEARCH`  
**Last investigated:** 2026-03-23  

---

## Target URL

`https://www.fly2houston.com/iah/security`

---

## Investigation Log

### Pass 1 (2026-03-23 — static scan)

`fly2houston.com/iah/security` returns HTTP 200 with server-rendered HTML containing wait-time keyword context. However, the actual wait-time data is **not present in the static HTML** — it is loaded dynamically via JavaScript/AJAX.

Key findings:
- Page contains `<meta>` tags and structural content
- No JSON API key extraction possible from JS bundles
- No skydive/mobi API domain (`api.iahairport.mobi`) exists
- No standard REST or GraphQL endpoint found
- Wait time data fetched via client-side JS (XHR/fetch)

### Pass 2 (2026-03-23 — API pattern probes)

Tested common endpoint patterns:
- `https://api.fly2houston.com/wait-times` → 404
- `https://api.iah.aero/wait-times` → 404/timeout
- `https://www.fly2houston.com/api/wait-times` → 404
- No GraphQL endpoint detected

---

## Most Promising Lead

**Dynamic client-side rendering via XHR**

The page loads wait-time data after initial HTML render, likely via:
1. A private airport API (not publicly documented)
2. A third-party wait-time vendor (QLess, Passur, etc.)
3. An embedded iframe or widget

**To unlock:** Requires headless browser automation (Playwright, Selenium) to intercept network requests and capture the actual XHR call URL and response.

---

## Next Steps

1. **Headless browser capture** — Use Playwright to load `fly2houston.com/iah/security` and monitor network tab for XHR requests to `/wait` or `/api/*` endpoints
2. **Check for embedded vendor widgets** — Some airports embed QLess or Passur wait-time displays; inspect iframe sources
3. **Re-probe if airport launches public API** — Check back periodically

---

## Notes

- Part of batch onboarding (IAH, LAS, BWI, DTW, IAD, DCA) on 2026-03-23
- All 6 airports follow same pattern: server-rendered page + dynamic JS-loaded data
- None expose public APIs without headless browser
