# George Bush Intercontinental Airport (IAH)

**Status:** Live

**Data Source:**
- Endpoint: `https://api.houstonairports.mobi/wait-times/checkpoint/iah`
- Auth: Requires `api-key` header (provided via `IAH_API_KEY` env var) and `api-version: 120`.
- Response Structure: JSON object containing a `data.wait_times` array with checkpoint details.

**Notes:**
- Returns `waitSeconds` which are parsed down to minutes.
- Returns an `isDisplayable` boolean field to indicate if the checkpoint is currently active.
- Includes an entry for immigration/FIS which should be ignored for standard TSA wait times tracking.
