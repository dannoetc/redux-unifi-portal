# Local Development Setup (Docker + host tooling)

This is the **developer** setup (run on your laptop).  
If you’re deploying to a server, use: **[Production Deployment](deployment-ubuntu20-digitalocean.md)**.

---

## 0) Before you start

Install:

1. **Docker**
2. **Python 3.11+**
3. **Node.js 18+**

---

## 1) Get the code

```bash
git clone <this-repo-url>
cd redux-unifi-portal
```

---

## 2) Make your `.env`

```bash
cp .env-sample .env
```

For local dev, set:

- `SECRET_KEY` (anything random is fine)
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8000`

---

## 3) Start Postgres + Redis

```bash
docker compose up -d postgres redis
```

---

## 4) Start the backend API

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Leave this terminal open.

---

## 5) Start the frontend web app

Open a new terminal tab:

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:3000

---

## 6) Seed a demo tenant (optional)

Open another terminal tab:

```bash
cd backend
SUPERADMIN_PASSWORD=change-me TENANT_SLUG=acme TENANT_NAME="Acme MSP" SITE_SLUGS=lab,office SITE_DISPLAY_NAMES="Lab,Office" SITE_UNIFI_SITE_IDS=default,default UNIFI_BASE_URL=https://unifi.local UNIFI_API_KEY=replace-with-unifi-api-key python -m app.scripts.seed
```

---

## 7) Log in

- http://localhost:3000/admin
