# SEA — Seattle-Tacoma International Airport

## Status: IN_RESEARCH

## Investigated
- `portseattle.org/sea-tac/security-screening` → 404
- `portseattle.org/sea-tac/security-screening-checkpoints` → 200 HTML (Drupal)
  - Static page, no JSON API references, no wait time data in HTML
- `api.seatacairport.mobi` → DNS does not resolve (no skydive backend)
- `api.sea-tac.mobi` → DNS does not resolve
- `seaspotsaver.com` → DNS does not resolve (Port of Seattle wait-time notification
  service referenced in page footer; domain not publicly accessible)
- `portseattle.org/api/security-wait-times` → 404

## Conclusion
No public JSON or HTML-scrape endpoint found. Port of Seattle does not expose
TSA wait time data via any accessible API. The `seaspotsaver.com` service
exists but its domain is unreachable externally.

## Next Steps
- Monitor if Port of Seattle launches a public wait times API.
- Check if `seaspotsaver.com` becomes externally accessible.
- Potential headless browser scrape if a page with dynamic data is found.
