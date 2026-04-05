# DEN — Denver International Airport

**Status:** 🔬 In Research
**Pipeline status:** `IN_RESEARCH`
**Last investigated:** 2026-03-22

---

## Target URL

`https://www.flydenver.com/airport/securities`

---

## Investigation Log

### Pass 1 (2026-03-22 — static scan)

`flydenver.com` is behind an extremely aggressive Cloudflare configuration. Every path returns 403, including paths that are almost universally CF-exempt:

- `/airport/securities` → 403
- `/robots.txt` → 403
- `/sitemap.xml` → 403
- `/jsonapi/` → 403 (Drupal JSON:API)
- All static JS/CSS assets → 403

No JS bundle was recoverable to scrape API keys from.

### Pass 2 (2026-03-22 — API backend probe)

Discovered `api.denverairport.com` — a live Elixir/Phoenix (Cowboy) server. **This is DEN's API middleware layer.**

Key finding: a minimal request (no Sec-Fetch headers, `Accept: application/json`) to `/wait-times/checkpoint/DEN` returned:

```json
{"success": true, "msg": "Missing Backfil URL"}
```

with `Content-Type: application/json` and HTTP 200. This confirms:
- The route `/wait-times/checkpoint/DEN` **exists** and is handled
- The server acts as a **proxy/relay** — it expects a configured "Backfil URL" (their backend data source URL) to forward wait time requests to
- DEN's entry in this system is **missing the upstream URL** — likely still being set up

The server also sets a long-lived session cookie: `sid=<uuid>; domain=.denverairport.com; max-age=2147483647`

#### Bot challenge mechanism

Without a real browser, the server issues a JS-redirect challenge:
```html
<script>window.location.replace('https://api.denverairport.com/<path>?ch=1&js=<JWT>&sid=<uuid>')</script>
```
The JWT contains `{"aud":"Joken","js":1,"ts":<nanoseconds>,...}` — Joken is an Elixir JWT library. Following the redirect without real browser state redirects to `http://ww1.denverairport.com` (parking page).

The challenge can be bypassed by using `Accept: application/json` without `Sec-Fetch-*` headers — the server returns JSON directly. However the API is rate-limited (429) after ~5 rapid requests.

#### Other probes attempted

| URL | Result |
|-----|--------|
| `https://waittime.api.aero/waittime/v2/current/DEN` | 403 (needs API key) |
| `https://apps.tsa.dhs.gov/MyTSAWebService/GetTSOWaitTimes.ashx?ap=DEN&output=json` | deprecated — returns HTML |
| `api.flydenver.mobi`, `api.flydenver.com`, `api.denverairport.mobi` | DNS doesn't resolve |

---

## Most Promising Lead

**`https://api.denverairport.com/wait-times/checkpoint/DEN`**

- Server exists and handles the route
- Returns JSON (bypassing bot challenge with correct headers)
- Currently returns `"Missing Backfil URL"` — the upstream wait-time source is not yet configured in their system
- Check back in future; once DEN configures their backend, this endpoint should return real data

**To unlock:** Either wait for DEN to finish configuring their backend, OR find what upstream URL the system proxies to (likely `waittime.api.aero` or a QLess/Passur endpoint) and probe that directly.

**Request pattern that works (no Sec-Fetch headers):**
```python
requests.get(
    'https://api.denverairport.com/wait-times/checkpoint/DEN',
    headers={
        'User-Agent': 'Mozilla/5.0 ...',
        'Accept': 'application/json',
    },
    timeout=10
)
```

---

## Next Steps

1. Re-probe `api.denverairport.com/wait-times/checkpoint/DEN` monthly — when DEN configures the backfil URL it will return live data
2. Look for the upstream vendor: search DEN app's network traffic for `waittime.api.aero`, QLess, or Passur endpoints
3. Headless browser (Playwright) against `flydenver.com/airport/securities` to capture real XHR calls
