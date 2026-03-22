# MCO — Orlando International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_KEY_REQUIRED`  
**Onboarded:** Pre-existing  

---

## Endpoint

```
GET https://api.goaa.aero/wait-times/checkpoint/MCO
```

**Auth headers:**
```
api-key: <key>
api-version: <version>
```

Default values (from bundle / env):
- Key: `8eaac7209c824616a8fe58d22268cd59`
- Version: `140`

Can be overridden via env vars `MCO_API_KEY` and `MCO_API_VERSION`.

**Additional headers required:**
```
referer: https://flymco.com/
content-type: application/json
```

---

## Response Schema

Same skydive-style response as CLT and DFW:

```json
{
  "data": {
    "wait_times": [
      {
        "name": "A",
        "lane": "General",
        "isOpen": true,
        "isDisplayable": true,
        "waitSeconds": 240
      }
    ]
  }
}
```

- Skip rows where `isDisplayable` is false or `waitSeconds` is null.
- Convert `waitSeconds` → minutes.
- Checkpoint label: `"{name} ({lane})"` or just `name` if no lane.

---

## Notes

- Uses the `api.goaa.aero` skydive backend (Greater Orlando Aviation Authority).
- Same response schema as CLT/DFW (`api.*.mobi` / `api.*.aero` skydive family).
- Key appears stable (stored in bundle). No auto-refresh logic currently — if it breaks, update `MCO_API_KEY` env var or `_mco_cache` default.
- Typically returns ~6 rows.
