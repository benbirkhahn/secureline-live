# TSA Tracker (tsatracker.com)

Real-time TSA security checkpoint wait times for major US airports. This platform pulls data directly from official airport systems every 2 minutes, provides historical trend analysis, and is optimized for both speed and search engines.

---

## 🚀 Live Airports
The following airports have verified, official data feeds currently integrated:

| Code | Airport Name | Data Source |
| :--- | :--- | :--- |
| **PHL** | Philadelphia International | Official Metrics API |
| **MIA** | Miami International | Rotating API Key (Auto-refreshing) |
| **ORD** | Chicago O'Hare | Official Wait Times API |
| **CLT** | Charlotte Douglas | `api.cltairport.mobi` Integration |
| **MCO** | Orlando International | `api.goaa.aero` Integration |
| **JAX** | Jacksonville International | HTML Table Scrape |
| **DFW** | Dallas/Fort Worth | `api.dfwairport.mobi` Integration |
| **LAX** | Los Angeles International | HTML Table Scrape |
| **JFK** | John F. Kennedy International | PANYNJ GraphQL API |
| **EWR** | Newark Liberty International | PANYNJ GraphQL API |
| **LGA** | LaGuardia Airport | PANYNJ GraphQL API |
| **SEA** | Seattle-Tacoma International | Drupal JSON API |

---

## 🛠 Features
- **Real-time Polling**: Background poller refreshes data every 120 seconds.
- **Historical Trends**: Stores samples in SQLite to generate 12-hour wait history charts.
- **Smart SEO**: Automatic landing pages for every airport (`/airports/phl-tsa-wait-times`) with structured JSON-LD data for search engines.
- **Monetization Ready**: Integrated slots for Google AdSense and affiliate CTAs (Uber, Lyft, Parking, Klook).
- **Lightweight UI**: Built with pure CSS and Vanilla JS for sub-second page loads.
- **Self-Healing**: Collectors for airports like MIA and CLT automatically re-scrape official site bundles if API keys expire.

---

## 📂 Project Structure
- `app.py`: Main Flask application, background poller, and data collectors.
- `airport_research/`: Detailed investigation logs for endpoint discovery and reverse engineering.
- `static/`: Frontend assets (styles, charts, search logic).
- `templates/`: Semantic HTML5 templates with Jinja2.
- `data.db`: SQLite database for wait-time samples.

---

## 💻 Getting Started

### Local Development
1. Clone the repository.
2. Create and activate a virtual environment:
   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```
3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
4. Run the application:
   ```bash
   python app.py
   ```
5. Open `http://localhost:8080`.

---

## 🚢 Deployment
TSA Tracker is built for production readiness on **Render**, **Heroku**, or **Docker**.

### Render (Recommended)
This repository includes a `render.yaml` Blueprint.
1. Connect this repo to Render.
2. Confirm environment variables (refer to `.env.example`).
3. Deploy the `web` service for Flask and the `collector` worker for polling.

### Processes
- Web: `gunicorn --workers 1 --threads 4 --bind 0.0.0.0:$PORT wsgi:app`
- Collector once: `python collector.py --once`
- Collector loop: `python collector.py --loop`

### Environment Variables
| Variable | Description | Default |
| :--- | :--- | :--- |
| `ENABLE_POLLER` | Legacy toggle for choosing collector mode outside the web process | `true` |
| `POLL_SECONDS` | Interval between data refreshes | `120` |
| `DB_PATH` | Path to SQLite database | `data.db` |
| `COLLECT_NOW_TOKEN` | Secret token to trigger manual fetch via API | Required |
| `SITE_URL` | Used for Canonical URLs/SEO | `https://tsatracker.com` |

---

## 🔬 Pipeline
Airports currently under research for future integration:
- **ATL**, **DEN**, **SFO**, **IAH**, **LAS**, **BWI**, **DTW**, **IAD**, **DCA**.

Detailed research logs for these can be found in `airport_research/pipeline/`.
