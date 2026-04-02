# Denver International Airport (DEN)

**Status:** Live

**Data Source:**
- Endpoint: `https://app.flyfruition.com/api/public/tsa`
- Auth: Requires `x-api-key` header (provided via `DEN_API_KEY` env var)
- Response Structure: JSON array containing checkpoint objects (`East Security`, `West Security`), each with a `lanes` array containing wait times.

**Notes:**
- Previous attempts to use `api.denverairport.com` failed due to missing backend configuration ("Missing Backfil URL"), and `flydenver.com` was Cloudflare-blocked.
- We successfully bypassed this by sniffing the Network requests and identifying the FlyFruition API powered by an API key.
