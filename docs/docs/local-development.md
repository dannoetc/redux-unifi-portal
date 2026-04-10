# Local Development Setup (Docker + host tooling)

This is the **developer** setup (run on your laptop).  
If you’re deploying to a server, use: **[Production Deployment (Ubuntu / DigitalOcean)](deployment-ubuntu20-digitalocean.md)**.

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
- `SECRETS_ENCRYPTION_KEY` — required if you use encrypted secrets; generate with:
  `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

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

## 5) Start the Celery worker (required for Email OTP)

Open a new terminal tab:

```bash
cd backend
source .venv/bin/activate
celery -A app.worker worker --loglevel=info
```

Leave this terminal open.

---

## 6) Start the frontend web app

Open a new terminal tab:

```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:3000

---

## 7) Run initial setup

Open in browser:

- http://localhost:3000/setup

Complete:

- initial superadmin
- initial tenant
- optional initial site

Seed-script fallback (optional, non-interactive):

```bash
cd backend
SUPERADMIN_EMAIL=admin@example.com SUPERADMIN_PASSWORD=change-me TENANT_SLUG=acme TENANT_NAME="Acme MSP" SITE_SLUGS=lab SITE_DISPLAY_NAMES="Lab" SITE_UNIFI_SITE_IDS=default UNIFI_BASE_URL=https://unifi.local UNIFI_API_KEY=replace-with-unifi-api-key python -m app.scripts.seed
```

---

## 8) Log in

- http://localhost:3000/admin
