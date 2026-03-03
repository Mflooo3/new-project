# Backup Snapshot

- Created: `2026-03-03 04:12:39` (Asia/Dubai)
- Source project: `C:\Users\PC\new project`
- Backup project: `C:\Users\PC\new project_backup_20260303_041239`

## What is included

- Backend source (`backend/`)
- Frontend source (`frontend/`)
- Docker files and compose
- Environment files (`.env`, `.env.example`)

## Restore

1. Stop current stack:
   - `docker compose down`
2. Open backup folder:
   - `cd "C:\Users\PC\new project_backup_20260303_041239"`
3. Start from backup:
   - `docker compose up -d --build`

