# ReduxTC Portal Cheat Sheet (idiot-proof)

This is the **one-page, do-this-in-order** guide. Follow it exactly.

---

## 0) Before you start (install these)

You need these tools on your computer:

1. **Docker**
2. **Python 3.11+**
3. **Node.js 18+**

If you don’t have them, install them first. Then come back here.

---

## 1) Get the code

```bash
git clone <this-repo-url>
cd redux-unifi-portal
```

---

## 2) Make your `.env`

Copy the sample file and edit it.

```bash
cp .env-sample .env
```

Open `.env` and fill in **at least** these values:

- `SECRET_KEY` (make it a long random string)
- `DATABASE_URL` (leave as-is if you use Docker)
- `REDIS_URL` (leave as-is if you use Docker)
- `NEXT_PUBLIC_API_BASE_URL` (for local dev: `http://localhost:8000`)

If you don’t know what to put yet, **leave everything else as-is**.

---

## 3) Start Postgres + Redis

```bash
docker compose up -d postgres redis
```

Wait ~10 seconds.

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

Open a **new** terminal tab:

```bash
cd redux-unifi-portal/frontend
npm install
npm run dev
```

Frontend: http://localhost:3000

---

## 6) Seed a demo tenant (optional, but recommended)

Open **another** terminal tab:

```bash
cd redux-unifi-portal/backend
SUPERADMIN_PASSWORD=change-me \
TENANT_SLUG=acme \
TENANT_NAME="Acme MSP" \
SITE_SLUGS=lab,office \
SITE_DISPLAY_NAMES="Lab,Office" \
SITE_UNIFI_SITE_IDS=default,default \
UNIFI_BASE_URL=https://unifi.local \
UNIFI_API_KEY_REF=dev-unifi-key \
python -m app.scripts.seed
```

Notes:
- `SUPERADMIN_EMAIL` defaults to **jhalon@reduxtc.com**.
- If you want a different email, add `SUPERADMIN_EMAIL=you@example.com`.

---

## 7) Log in

1. Go to http://localhost:3000/admin
2. Use the email + password you seeded.

---

## 8) If something doesn’t work

- **Backend errors?** Check the backend terminal logs.
- **Frontend errors?** Check the frontend terminal logs.
- **DB connection errors?** Make sure Postgres is running (`docker compose ps`).
- **OTP emails not sending?** Check your SMTP settings in `.env`.

---

That’s it. If you followed every step, the portal should be running.
