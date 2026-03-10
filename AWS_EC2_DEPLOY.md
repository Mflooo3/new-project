# AWS EC2 Production Deploy (reconlab.ae)

This guide deploys the project in production mode on EC2 using:

- Domain: `reconlab.ae`
- Domain: `www.reconlab.ae`
- Server IP: `100.50.24.107`

## 1) DNS / Domain

Ensure these records exist:

- `A  reconlab.ae      -> 100.50.24.107`
- `A  www.reconlab.ae  -> 100.50.24.107`

## 2) Production files added in project

- `docker-compose.prod.yml` (production services, no dev mounts, restart policy)
- `frontend/Dockerfile.prod` (Vite build -> Nginx runtime)
- `frontend/nginx/default.conf` (serves frontend + proxies `/api/*` to backend)

## 3) Prepare your production `.env`

Use your real secrets and set at least:

```env
ENVIRONMENT=production

# DB/Cache
POSTGRES_DB=gulf_monitor
POSTGRES_USER=gulf_user
POSTGRES_PASSWORD=<strong-password>
DATABASE_URL=postgresql+psycopg://gulf_user:<strong-password>@postgres:5432/gulf_monitor
REDIS_URL=redis://redis:6379/0

# Security
AUTH_JWT_SECRET=<very-long-random-secret>
SUPER_ADMIN_EMAIL=<your-admin-email>
SUPER_ADMIN_PASSWORD=<your-admin-password>

# API target in production (frontend -> nginx -> backend)
VITE_API_BASE_URL_PROD=/api

# Reset link + allowed origins
PASSWORD_RESET_URL_TEMPLATE=https://reconlab.ae/?auth=reset&token={token}
CORS_ORIGINS=https://reconlab.ae,https://www.reconlab.ae,http://100.50.24.107

# Email / SES (if used)
EMAIL_PROVIDER=aws_ses
AWS_REGION=us-east-1
SES_FROM_EMAIL=info@reconlab.ae
SES_FROM_NAME=ReconLab
AWS_ACCESS_KEY_ID=<aws-key>
AWS_SECRET_ACCESS_KEY=<aws-secret>

# AI / X
OPENAI_API_KEY=<openai-key>
X_API_BEARER_TOKEN=<x-bearer-token>
```

## 4) Copy `.env` from your PC to the production server

From your local machine (PowerShell):

```powershell
scp -i "C:\path\to\your-key.pem" "C:\Users\PC\new-project\.env" ubuntu@100.50.24.107:~/new-project/.env
```

If your SSH username is different, replace `ubuntu` accordingly.

## 5) Deploy on EC2

SSH to server:

```bash
ssh -i /path/to/your-key.pem ubuntu@100.50.24.107
```

Then run:

```bash
cd ~/new-project
git fetch --all --tags
git checkout main
git pull origin main

# build + run production stack
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

# verify
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs backend --tail=80
docker compose -f docker-compose.prod.yml logs frontend --tail=80
```

## 6) Validate

- Open `http://100.50.24.107`
- Open `http://reconlab.ae`
- Open `http://www.reconlab.ae`

Health check from server:

```bash
curl -s http://127.0.0.1/api/health
```

## 7) HTTPS (recommended)

After HTTP is confirmed, put SSL in front (ALB/CloudFront/Nginx+Certbot) and switch:

- `PASSWORD_RESET_URL_TEMPLATE=https://reconlab.ae/?auth=reset&token={token}`
- `CORS_ORIGINS` remains HTTPS domains.

Recreate services after `.env` changes:

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```
