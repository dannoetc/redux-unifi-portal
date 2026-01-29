# ReduxTC UniFi Captive Portal (MSP-first)

This repository is a **two-package** monorepo overlay for:
- `backend/` — FastAPI + Postgres + Redis + Celery + UniFi Network API integration
- `frontend/` — Next.js (App Router) + TypeScript + Tailwind + shadcn/ui

> This is an **overlay scaffold** (no node_modules, no lockfiles). Install deps after unzip.

## Local Dev (quickstart)

### 1) Configure env
Copy `.env-sample` to `.env` and fill values (or start from `.env.example`).

### 2) Start infrastructure
```bash
docker compose up -d postgres redis
```

### 3) Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### 4) Frontend
```bash
cd ../frontend
npm install
npm run dev
```

Frontend runs on http://localhost:3000  
Backend runs on http://localhost:8000

## Docs
- One-page setup cheat sheet: `docs/docs/cheat-sheet.md`
- Full documentation site (MkDocs): `docs/docs`

## shadcn/ui setup
This scaffold includes the expected folders for shadcn/ui. Initialize when ready:
```bash
cd frontend
npx shadcn@latest init
```

## Notes
- Guest portal routes live in the frontend under `app/(guest)/...` and call backend APIs.
- Admin console routes live under `app/(admin)/...`.
