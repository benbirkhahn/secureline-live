# SFO — San Francisco International Airport

## Status: IN_RESEARCH

## Investigated
- `flysfo.com/passengers/plan-your-trip/security` → 404
- `flysfo.com/flight-info/alerts-advisories/tsa-lines-normal-wait-times` → 200
  - Page title: "TSA Lines – Normal Wait Times"
  - SFO participates in TSA Screening Partnership Program (SPP)
  - Wait time data is **not in static HTML** — loaded dynamically post-render
  - Drupal-based site (not Next.js); no bundle to extract API key from
- `api.sfoairport.mobi` → DNS does not resolve
- `api.sfogateway.com` → DNS does not resolve
- `flysfo.com/api/wait-times` → 404
- `flysfo.com/api/security-wait` → 404
- SF Open Data portal (data.sfgov.org) → no matching TSA wait dataset found

## Conclusion
SFO publishes a wait times page but the data is rendered client-side via
JavaScript after page load. No static JSON endpoint or public API discovered.
A headless browser (Playwright) scrape of the wait times page is the most
likely viable path.

## Next Steps
- Use Playwright to intercept XHR/fetch calls on the wait times page to
  identify the underlying API endpoint and any required auth tokens.
- Check if Drupal's REST API (`/jsonapi/...`) exposes the wait time content.
