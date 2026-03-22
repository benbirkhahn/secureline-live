# DFW — Dallas/Fort Worth International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_KEY_EMBEDDED`  
**Onboarded:** 2026-03-22  

---

## Endpoint

```
GET https://api.dfwairport.mobi/wait-times/checkpoint/DFW
```

**Auth headers:**
```
Api-Key: 87856E0636AA4BF282150FCBE1AD63DE
Api-Version: 170
```

Both values are embedded in DFW's public Next.js JS bundle. No login or token exchange required.

---

## Discovery Notes

- `dfwairport.com/security/` is a Next.js SSG site. Static `pageProps` (via `/_next/data/.../security.json`) contains only CMS content — no live wait data.
- The page body says *"Live wait times for each checkpoint are shown on the map above."* — map is a client-side React component.
- `go.elerts.com/dfw/waittimes` exists (200 OK) but is behind Cloudflare Turnstile — not scrapeable.
- The real API is the **skydive** backend at `api.dfwairport.mobi`. Key and version found by searching the `_app` bundle (`/_next/static/chunks/pages/_app-*.js`) for the string `accessDfwWaitTimesClientId`.
- The bundle also exposes MuleSoft/CloudHub credentials (`access-dfw-qless-waitinfo.us-e1.cloudhub.io/api/waitInfo`) but that endpoint returns only a single consolidated queue — not useful.

**Key location in bundle:**
```
accessDfwWaitTimesClientId:"be0f9a995f4f4615883ca9014a47d1d9"   ← not used
accessDfwWaitTimesClientSecret:"8cCc52aA5195412B8252ab8a942E9420" ← not used
Api-Key (skydive): 87856E0636AA4BF282150FCBE1AD63DE             ← this is the one
Api-Version: 170
```

---

## Response Schema

```json
{
  "data": {
    "wait_times": [
      {
        "id": "A12_General",
        "name": "A12",
        "lane": "General",
        "openTime": "04:00",
        "closeTime": "20:00",
        "isOpen": false,
        "isDisplayable": true,
        "waitSeconds": 120,
        "predictions": [ ... ]
      }
    ]
  }
}
```

- Skip rows where `isDisplayable` is false.
- Convert `waitSeconds` → minutes.
- Checkpoint label: `"{name} ({lane})"` (e.g. `"A12 (General)"`, `"A21 (TSA Pre)"`).

---

## Checkpoints

Covers all five terminals (A, B, C, D, E) with multiple lanes per checkpoint:
- **General** — standard screening
- **Priority** — premium/elite lanes
- **TSA Pre** — PreCheck lanes

Typically returns **~31 rows** spanning the entire airport.

---

## Gotchas

- The `Api-Key` is embedded in the public JS bundle — it could rotate if DFW deploys a new build. If calls start returning `401`, re-scrape `/_next/static/chunks/pages/_app-*.js` for the updated key (same search pattern as CLT).
- A `buildId` in the page HTML (`GxH8HdQLnNbQp--ktk6Z_` as of onboarding) can be used to find the current app bundle path.
- The CloudHub API (`access-dfw-qless-waitinfo.us-e1.cloudhub.io`) is a different system (QLess) — only returns one aggregate queue and is not useful for per-checkpoint data.
