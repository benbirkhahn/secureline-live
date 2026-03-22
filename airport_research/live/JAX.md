# JAX — Jacksonville International Airport

**Status:** ✅ Live  
**Mode:** `LIVE_PUBLIC`  
**Onboarded:** 2026-03-21  

---

## Endpoint

```
GET https://www.flyjacksonville.com/content.aspx?id=3583
```

**Auth:** None — public server-rendered HTML page.  
**Headers:** Standard `User-Agent` only.

---

## Discovery Notes

- The page's only JavaScript (`WaitTimes/html/Script.js`) is a text rotator — no API calls.
- Wait times are **server-rendered directly into the HTML** on each page load.
- No JSON endpoint exists; data is parsed via regex from the HTML.

---

## HTML Structure

The wait times section contains three checkpoint blocks:

```html
<div class="label">Standard</div>
<div class="time ...">
  <span class="bold ml-1">less than a min</span>
  <span class="medium ml-2">estimated</span>
</div>
```

The second checkpoint uses `id="changing-label"` and rotates between
"Military in Uniform", "Premier", and "Special Needs" via JS — all three
share one physical lane, normalized to **"Priority Lane"** in our output.

---

## Parsing

Regex pattern matches `<div class="label...">NAME</div>` followed by
`<span class="bold...">TIME</span>` within the wait-times section.

**Time conversion (`_parse_jax_wait_minutes`):**

| Raw text | Minutes stored |
|----------|---------------|
| `"less than a min"` | `0.5` |
| `"X min"` / `"X minutes"` | `float(X)` |

---

## Checkpoints Returned

| Checkpoint | Notes |
|-----------|-------|
| Standard | Main lane |
| Priority Lane | Military / Premier / Special Needs (same physical lane) |
| TSA Pre | PreCheck lane — closes ~7 PM each evening |

Typically returns **3 rows**.

---

## Gotchas

- PreCheck and Priority lanes close around 7:00 PM daily; those checkpoints will still appear with their last known value. The page notes this with: *"The Pre-Check and Premier/Special Needs lanes close around 7:00 pm..."*
- Page includes a timestamp like `"as of 3/21/2026 11:15:18 PM"` — not currently captured but could be used to detect stale data.
