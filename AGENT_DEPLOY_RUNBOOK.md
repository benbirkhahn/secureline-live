# Agent Deployment Runbook (No Product Decisions Needed)
This runbook is for an AI agent/operator to deploy `tsatracker.com` without asking for implementation choices.

## Repository
- URL: `https://github.com/benbirkhahn/tsatracker.com`
- Branch: `main`

## Target platform
- Preferred: Render (Blueprint-based deploy via `render.yaml`)

## Required secrets/config (collect from owner)
- `COLLECT_NOW_TOKEN` (long random value)
- AdSense values for `templates/index.html`:
  - `data-ad-client` (`ca-pub-...`)
  - two `data-ad-slot` IDs

## Deploy steps
1. In Render, create a new Blueprint service from this repository.
2. Confirm env vars:
   - `ENABLE_POLLER=true`
   - `AUTO_START_RUNTIME=true`
   - `POLL_SECONDS=120`
   - `COLLECT_NOW_TOKEN=<provided>`
3. Deploy.
4. Attach custom domain and enable SSL.
5. Validate:
   - `GET /healthz` returns `ok: true`
   - `GET /api/live` contains PHL/MIA/ORD data keys
6. Post-deploy hardening:
   - keep instance count = 1
   - keep `gunicorn --workers 1` (avoid duplicate polling)

## Acceptance checks
- Public homepage loads and shows:
  - Live airports section
  - In-progress airports section
  - History chart renders
- `/api/collect-now`:
  - without header token => 401
  - with `x-collect-token` => 200

## Operating procedure
- If collectors fail repeatedly, inspect logs for airport-specific errors.
- If MIA key expires, collector auto-refreshes key from official bundle.
- If data volume grows, migrate from SQLite to Postgres.
