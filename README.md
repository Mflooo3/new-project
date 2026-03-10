# Gulf Situation AI Monitor

Web platform for continuous Gulf-region situational awareness using multi-source ingestion (news, aviation, maritime, incident feeds), AI analysis, and real-time alerts.

## What This Starter Includes
- Backend API (`FastAPI`) with:
  - Source management (add/remove/enable live sources)
  - Periodic ingestion scheduler
  - Redis queue mode for ingestion workers
  - Gulf relevance filtering (geo + keyword)
  - AI analysis pipeline (heuristic + optional OpenAI model)
  - Alert generation and acknowledgment
  - Optional API key authentication
  - AI workspace endpoints (chat + analysis board/history)
  - Privacy mode (local-only AI processing, no external sharing)
  - Real-time event stream (SSE)
- Frontend dashboard (`React + Vite`) with:
  - Arabic RTL interface
  - Large live event timeline
  - Topic filters (e.g. `war`) + trusted-only mode
  - Top source drawer (kept away from main operations view)
  - AI chat panel + AI analysis board panel + report publishing
  - Alert panel
  - Real-time push updates + polling fallback
- Docker setup for full deployment (Postgres + Redis + API + Worker + UI)

## High-Level Architecture
- `Collectors`: Pull data from configured source endpoints by type (`news`, `flight`, `marine`, `incident`, `custom`).
- `Normalizer`: Maps raw source payloads into a common event schema.
- `Relevance Filter`: Keeps Gulf-related events using geo bounding-box and language signals.
- `AI Analyzer`: Adds severity, tags, and concise operational assessment.
- `Alert Engine`: Emits `high`/`medium` alerts based on severity and domain rules.
- `API + UI`: Exposes events/alerts/sources and streams updates to the dashboard.

## Important Source Notes
- FlightRadar24 and MarineTraffic are commercial products with license restrictions.
- Do not scrape protected websites.
- Use official APIs or licensed feeds and add them through `/sources` with parser hints:
  - `flightradar24`
  - `marinetraffic`

## Supported Parser Hints
- `rss`
- `opensky`
- `flightradar24`
- `marinetraffic`
- `cyber_rss`
- `social_reddit_json`
- `social_json`
- `social_rss`
- `generic_json_list`

## Trusted Publisher Pack
Trusted publisher feeds are supported for:
- CNN (`cnn.com`)
- Al Arabiya (`alarabiya.net`)
- Gulf News (`gulfnews.com`)

These are seeded by default at startup (if missing), and can also be added from the UI source drawer.

## Step-by-Step Run (Docker, Recommended)
1. Open terminal in project root:
   - `cd "c:\Users\PC\new project"`
2. Create environment file:
   - `Copy-Item .env.example .env`
3. Edit `.env` and set at least:
   - `APP_API_KEY` (strong secret)
   - `OPENAI_API_KEY` (optional)
   - `FR24_API_KEY` (if using FlightRadar24 licensed API)
   - `MARINETRAFFIC_API_KEY` (if using MarineTraffic licensed API)
   - Optional defaults for automatic source seeding:
     - `DEFAULT_FLIGHT_FEED=<your-fr24-endpoint>`
     - `DEFAULT_FLIGHT_PARSER_HINT=flightradar24`
     - `DEFAULT_MARINE_FEED=<your-marinetraffic-endpoint>`
     - `DEFAULT_MARINE_PARSER_HINT=marinetraffic`
4. Start all services:
   - `docker compose up --build`
5. Open UI:
   - `http://localhost:5173`
6. Open API docs:
   - `http://localhost:8000/docs`
7. Confirm health:
   - `GET http://localhost:8000/health`
8. Trigger manual ingest:
   - In UI click `Run Ingest Now`
   - or call `POST /ingest/run` with header `X-API-Key: <APP_API_KEY>`
9. If worker mode is enabled (`USE_REDIS_WORKER=true`), check job status:
   - `GET /jobs/{job_id}` with `X-API-Key`

## Quick Start (Local Dev)
### Backend
1. `cd backend`
2. `python -m venv .venv`
3. Activate venv
4. `pip install -r requirements.txt`
5. Ensure `.env` points to local services:
   - `DATABASE_URL=postgresql+psycopg://gulf_user:gulf_pass@localhost:5432/gulf_monitor`
   - `REDIS_URL=redis://localhost:6379/0`
6. Run API:
   - `uvicorn app.main:app --reload --port 8000`
7. Run worker (separate terminal):
   - `python -m app.worker`

### Frontend
1. `cd frontend`
2. `npm install`
3. Set env vars (optional file or shell):
   - `VITE_API_BASE_URL=http://localhost:8000`
   - `VITE_API_KEY=<APP_API_KEY>`
4. `npm run dev`

## Add Extra Live Sources
Use UI form or API:

```bash
curl -X POST http://localhost:8000/sources \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "FlightRadar24 Licensed Feed",
    "source_type": "flight",
    "endpoint": "https://fr24-licensed.example.com/v1/flights",
    "parser_hint": "flightradar24",
    "poll_interval_seconds": 120
  }'
```

```bash
curl -X POST http://localhost:8000/sources \
  -H "X-API-Key: <APP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "MarineTraffic Licensed Feed",
    "source_type": "marine",
    "endpoint": "https://api.marinetraffic.com/v2/exportvessel/v:8",
    "parser_hint": "marinetraffic",
    "poll_interval_seconds": 120
  }'
```

## API Endpoints
- `GET /health`
- `GET /events` (`query_text`, `trusted_only`, `source_type`, `min_severity`, `limit`)
- `GET /alerts`
- `POST /alerts/{alert_id}/ack`
- `GET /sources`
- `POST /sources`
- `PATCH /sources/{source_id}/toggle`
- `POST /ingest/run`
- `GET /jobs/{job_id}`
- `GET /stream` (Server-Sent Events)
- `GET /ai/privacy`
- `GET /ai/messages`
- `POST /ai/chat`
- `GET /ai/insights`
- `POST /ai/insights`
- `GET /ai/reports`
- `POST /ai/reports/publish`

## AI Mode
- If `OPENAI_API_KEY` is not set, system uses deterministic heuristic analysis.
- If `OPENAI_API_KEY` is set, system attempts model-based analysis and falls back safely if needed.

## Auth Notes
- When `API_KEY_ENABLED=true`, all non-health endpoints require:
  - Header: `X-API-Key: <APP_API_KEY>`
  - For SSE stream, API key can also be passed as query: `?api_key=<APP_API_KEY>`

## Privacy Notes
- `AI_PRIVACY_MODE=true` (default): assistant uses local reasoning only and does not send your data to external AI APIs.
- Set `AI_PRIVACY_MODE=false` only if you intentionally want model calls to external provider APIs.

## Production Notes
- This scaffold now supports Postgres + Redis worker mode.
- Production compose is available in:
  - `docker-compose.prod.yml`
  - `frontend/Dockerfile.prod`
  - `frontend/nginx/default.conf`
- Production deploy command:
  - `docker compose -f docker-compose.prod.yml --env-file .env up -d --build`
- In production `.env`, set:
  - `ENVIRONMENT=production`
  - `VITE_API_BASE_URL_PROD=/api`
  - `PASSWORD_RESET_URL_TEMPLATE=https://reconlab.ae/?auth=reset&token={token}`
  - `CORS_ORIGINS=https://reconlab.ae,https://www.reconlab.ae,http://100.50.24.107`
- For EC2 + domain deployment steps, see:
  - `AWS_EC2_DEPLOY.md`
