# ReduxTC UniFi Portal

A multi-tenant UniFi captive portal + admin UI, packaged as a Docker Compose stack with a built-in **nginx reverse proxy + Certbot** for HTTPS.

## What’s in the stack

- **Frontend:** Next.js web app (`frontend`)
- **API:** Python/FastAPI service (`backend`)
- **Worker:** Celery worker for background jobs (`celery`)
- **Database:** Postgres (`postgres`)
- **Cache / broker:** Redis (`redis`)
- **Docs:** documentation server (`docs`)
- **Edge:** nginx reverse proxy (`nginx`) + Let’s Encrypt (`certbot`)

nginx routes:
- `/` → frontend
- `/api/` → API
- `/docs/` → docs
- `/.well-known/acme-challenge/` → Certbot webroot for Let’s Encrypt

---

## Quick start (Docker Compose)

### 1) Prerequisites

- Docker Engine
- Docker Compose (plugin)

### 2) Clone

```bash
git clone <this-repo-url>
cd redux-unifi-portal
```

### 3) Create `.env`

Start from the sample:

```bash
cp .env-sample .env
# (equivalent templates also exist as .env-example and .env.example)
```

Minimum recommended values to set for **any** environment:

- `SECRET_KEY` — long random string
- `SECRETS_ENCRYPTION_KEY` — Fernet key used to encrypt UniFi/OIDC secrets in DB
- `NEXT_PUBLIC_API_BASE_URL` — API base URL the frontend should use (see below)
- `BASE_URL` — public base URL used by the backend (links, redirects)
- `DOMAIN` — the domain nginx should serve (also used for cert paths)
- `LETSENCRYPT_EMAIL` — email for Let’s Encrypt registration/renewal notices

#### Docker Compose values (recommended)

When running the full stack via Docker Compose, **do not use** `localhost` for Postgres/Redis inside containers.
Use the service names on the Docker network (or omit these vars and let Compose defaults apply):

```env
# Public URLs
DOMAIN=portal.example.com
LETSENCRYPT_EMAIL=ops@example.com
BASE_URL=https://portal.example.com
NEXT_PUBLIC_API_BASE_URL=https://portal.example.com

# Secrets
SECRET_KEY=replace-me-with-a-long-random-string
SECRETS_ENCRYPTION_KEY=replace-with-fernet-key

# Docker-network DB/Redis (recommended when set explicitly)
DATABASE_URL=postgresql+psycopg://postgres:postgres@postgres:5432/redux_portal
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

> If you leave the sample `DATABASE_URL=...@localhost...` / `REDIS_URL=...localhost...` in place, containers will try to connect to themselves and fail.
>
> Generate `SECRETS_ENCRYPTION_KEY` with:
> `docker compose run --rm api python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`

#### Local development values (optional)

If you run the backend on your host (not in Docker) but keep Postgres/Redis in Docker:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
BASE_URL=http://localhost:3000
DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/redux_portal
REDIS_URL=redis://localhost:6379/0
```

---

## Run the stack

### 1) Start the core services

```bash
docker compose up -d postgres redis
```

### 2) Build + start everything (including nginx)

```bash
docker compose up -d --build
```

Check status:

```bash
docker compose ps
```

### 3) Run database migrations

```bash
docker compose run --rm api alembic upgrade head
```

---

## Seed a demo tenant (recommended)

This creates a demo tenant/sites and an admin account so you can log in.

```bash
docker compose run --rm api sh -c '\
  SUPERADMIN_PASSWORD=change-me \
  TENANT_SLUG=acme \
  TENANT_NAME="Acme MSP" \
  SITE_SLUGS=lab,office \
  SITE_DISPLAY_NAMES="Lab,Office" \
  SITE_UNIFI_SITE_IDS=default,default \
  UNIFI_BASE_URL=https://unifi.local \
  UNIFI_API_KEY=replace-with-unifi-api-key \
  python -m app.scripts.seed'
```

If you want a different admin email:

```bash
docker compose run --rm api sh -c '\
  SUPERADMIN_EMAIL=you@example.com \
  SUPERADMIN_PASSWORD=change-me \
  python -m app.scripts.seed'
```

---

## Enable HTTPS with Let’s Encrypt (DigitalOcean / production)

### Requirements

- Your domain’s **A record** points to this server’s public IP
- Ports **80** and **443** are reachable from the internet

### Get/renew certificates

The repo includes a `certbot` service configured for webroot validation. Run it any time:

```bash
docker compose run --rm certbot
```

Or (equivalent) bring the service up:

```bash
docker compose up --force-recreate --no-deps --build certbot
```

View logs:

```bash
docker compose logs -f certbot
docker compose logs -f nginx
```

After cert issuance/renewal, nginx reloads and begins serving HTTPS.

---

## Where to access

- Frontend: `https://<DOMAIN>/`
- Admin: `https://<DOMAIN>/admin`
- API: `https://<DOMAIN>/api/...`
- Docs: `https://<DOMAIN>/docs/`

---

## Troubleshooting

### Check container status

```bash
docker compose ps
```

### Check logs

```bash
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f postgres
docker compose logs -f redis
docker compose logs -f certbot
```

### Common issues

- **502 / Bad Gateway (nginx):** API or frontend not healthy. Check `docker compose logs api` and `docker compose logs frontend`.
- **DB connection failures:** Ensure Postgres is running and `DATABASE_URL` uses `postgres` host name when inside Docker.
- **Redis/broker failures:** Ensure `REDIS_URL` uses `redis` host name when inside Docker.
- **Certbot failures:** DNS not pointing to this server or port 80 blocked.

---

## Certificate renewals (recommended)

Certbot is not scheduled automatically. Add a cron job on the host:

```bash
sudo crontab -e
```

Example: weekly renewal attempt at 3:00 AM Sunday:

```cron
0 3 * * 0 cd /srv/redux-unifi-portal && /usr/bin/docker compose run --rm certbot >> /var/log/certbot_docker.log 2>&1
```

---

## Maintenance

```bash
# update code + rebuild + restart
git pull
docker compose up -d --build

# apply migrations after updates
docker compose run --rm api alembic upgrade head

# stop everything
docker compose down

# WARNING: delete volumes (destroys DB data)
docker compose down -v
```
