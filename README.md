# TSA Tracker (tsatracker.com)
Public TSA wait-time site with two core sections:
- Live airports with verified real-source feeds
- In-progress airports that graduate to live after endpoint verification

## Live sources currently wired
- PHL: `https://www.phl.org/phllivereach/metrics`
- MIA: `https://waittime.api.aero/waittime/v2/current/MIA` (x-apikey extracted from official page JS)
- ORD: `https://tsawaittimes.flychicago.com/tsawaittimes`

## In progress
- CLT, MCO, JAX

## Run locally
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open:
- `http://localhost:8080`

## Monetization hooks
- AdSense slots are pre-placed in `templates/index.html`
- Controlled by env vars:
  - `ENABLE_ADSENSE=true`
  - `ADSENSE_CLIENT=ca-pub-...`
  - `ADSENSE_SLOT_TOP=...`
  - `ADSENSE_SLOT_BOTTOM=...`
- If AdSense is not enabled, sponsor CTA fallback is shown:
  - `SPONSOR_CTA_URL=...`
  - `SPONSOR_CTA_TEXT=...`

## Notes
- Poll interval is currently 120 seconds.
- Data is stored in SQLite `data.db`.
- Endpoint reliability and airport statuses are exposed in API routes.

## Production (AI-agent operable)
This repo includes:
- `Procfile` for PaaS launch
- `render.yaml` for Render Blueprint deploy
- `Dockerfile` for container hosting
- `.env.example` for required environment variables

### Minimum env vars
- `COLLECT_NOW_TOKEN` (required to protect `/api/collect-now`)
- `ENABLE_POLLER=true`
- `AUTO_START_RUNTIME=true`
- `POLL_SECONDS=120`

### One-pass deploy flow (Render)
1. Connect repo in Render
2. Use Blueprint from `render.yaml`
3. Set custom domain + SSL
4. Verify `https://<domain>/healthz` returns `{ "ok": true }`
5. Verify `https://<domain>/api/live` has PHL/MIA/ORD rows

### Security and operations checklist
- Keep `COLLECT_NOW_TOKEN` secret
- Restrict `/api/collect-now` calls to automation only
- Monitor app logs for collector failures
- Keep service at a single worker (`gunicorn --workers 1`) to avoid duplicate polling
- If moving to Postgres later, replace SQLite helpers in `app.py`
