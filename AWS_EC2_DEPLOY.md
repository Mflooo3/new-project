# AWS EC2 Production Deploy (Docker Compose)

This project runs on AWS EC2 (Ubuntu) with Docker Compose.

## Production Rule
- Frontend must **not** use `localhost` for API in production.
- Frontend API must come from env vars:
  - `VITE_API_BASE_URL=${VITE_API_BASE_URL}`
  - `VITE_API_KEY=${APP_API_KEY}`

## Required `.env` value (production)
```env
VITE_API_BASE_URL=http://52.90.223.22:8001
```

## Deploy Update Steps
```bash
cd ~/new-project
git pull origin main
docker compose down
docker compose build --no-cache
docker compose up -d
docker compose ps
```

## Release Checklist (each new build)
1. Push code to `main`.
2. Confirm `docker-compose.yml` frontend uses env-based API URL (no localhost).
3. Confirm EC2 `.env` has correct `VITE_API_BASE_URL`.
4. Run deploy update steps above.
