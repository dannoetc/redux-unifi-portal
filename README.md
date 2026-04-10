# ReduxTC UniFi Portal

A **multi-tenant external captive portal** for UniFi Hotspot networks, built for MSPs and multi-site operators. Guests join your WiFi, complete an auth flow, and the portal authorizes them through the UniFi API. Each customer is an isolated tenant with their own sites, branding, and access policies.

Packaged as a Docker Compose stack with a built-in **nginx reverse proxy + Let's Encrypt** — production-ready out of the box.

---

## What it does

When a guest connects to a UniFi Hotspot SSID, UniFi redirects them to this portal. The portal:

1. Resolves the correct tenant and site from the redirect
2. Presents the guest with the configured auth method(s)
3. Authorizes the device through the UniFi Network API on success

### Guest auth methods

| Method | Description |
|---|---|
| **Voucher** | Guest enters a staff-issued code |
| **Email OTP** | Guest enters their email and verifies a one-time code |
| **OIDC SSO** | Guest signs in with a configured identity provider (e.g. Microsoft Entra ID) |
| **Terms only** | Guest accepts terms of service with no identity check |

Sites can enable any combination of methods. Each site can have its own branding (logo, colors) and optionally a fully custom HTML portal template.

### Admin console

Superadmins and tenant admins manage everything from a web UI at `/admin`:

- **Tenants** — create and manage customer organizations with their own UniFi controller credentials
- **Sites** — per-location branding, portal templates, guest policies (time/data/bandwidth limits), and OIDC configuration
- **Vouchers** — generate batches of redemption codes and export as CSV
- **OIDC providers** — configure SSO per tenant; enable per site with optional domain allowlist
- **Auth Events** — full audit trail of every guest auth attempt with filters and CSV export
- **Reports** — method and site trend summaries with exportable data
- **Settings** — SMTP configuration, admin UI preferences, and TLS certificate management

### Multi-tenant design

Every record is scoped to a tenant or site. Tenant admins only see their own data. Superadmins can manage the full platform. A first-run setup wizard bootstraps the initial superadmin, tenant, and site.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript + Tailwind CSS + shadcn/ui |
| API | Python / FastAPI |
| Worker | Celery (email OTP delivery, async jobs) |
| Database | PostgreSQL (SQLAlchemy 2 + Alembic) |
| Cache / broker | Redis (sessions, OTP state, rate limiting) |
| Docs | MkDocs documentation server |
| Edge | nginx reverse proxy + Certbot (Let's Encrypt) |

nginx routes:

| Path | Target |
|---|---|
| `/` | Frontend |
| `/api/` | API |
| `/docs/` | Docs |
| `/.well-known/acme-challenge/` | Certbot webroot |

---

## Quick start

### Prerequisites

- Docker Engine + Docker Compose plugin
- A domain with its DNS A record pointing to your server (for HTTPS)

### 1) Clone

```bash
git clone <this-repo-url>
cd redux-unifi-portal
```

### 2) Create `.env`

```bash
cp .env-sample .env
```

Minimum required values:

```env
DOMAIN=wifi.example.com
LETSENCRYPT_EMAIL=ops@example.com
BASE_URL=https://wifi.example.com
NEXT_PUBLIC_API_BASE_URL=https://wifi.example.com

SECRET_KEY=replace-with-long-random-string
SECRETS_ENCRYPTION_KEY=replace-with-fernet-key

# Docker network service names (required when running in Compose)
DATABASE_URL=postgresql+psycopg://postgres:postgres@postgres:5432/redux_portal
REDIS_URL=redis://redis:6379/0
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

> Generate `SECRETS_ENCRYPTION_KEY` with:
> ```bash
> docker compose run --rm api python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
> ```

### 3) Build and start

```bash
docker compose up -d --build
```

### 4) Issue TLS certificate

```bash
docker compose run --rm certbot
```

### 5) Run database migrations

```bash
docker compose exec api alembic upgrade head
```

### 6) Complete the setup wizard

Open `https://wifi.example.com/setup` and create your first superadmin, tenant, and site. On completion, you're redirected to the admin console.

---

## Accessing the platform

| URL | Purpose |
|---|---|
| `https://<DOMAIN>/admin` | Admin console |
| `https://<DOMAIN>/guest/` | Guest portal entrypoint (use this as the UniFi external portal URL) |
| `https://<DOMAIN>/api/` | REST API |
| `https://<DOMAIN>/docs/` | Documentation |

---

## Documentation

Full operator and integration docs are served at `/docs/` when the stack is running, and live in [`docs/docs/`](docs/docs/).

Key guides:

- [Cheat sheet (production)](docs/docs/cheat-sheet.md)
- [Production deployment (Ubuntu / DigitalOcean)](docs/docs/deployment-ubuntu20-digitalocean.md)
- [Local development](docs/docs/local-development.md)
- [Tenant onboarding](docs/docs/tenant-onboarding.md)
- [UniFi setup](docs/docs/unifi-setup.md)
- [Email OTP (SMTP)](docs/docs/email-otp-smtp.md)
- [OIDC SSO (Microsoft Entra ID)](docs/docs/oidc-m365.md)
- [Troubleshooting](docs/docs/troubleshooting.md)

---

## Troubleshooting

```bash
# Check container status
docker compose ps

# Tail logs
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f celery
docker compose logs -f postgres
```

Common issues:

| Symptom | Likely cause |
|---|---|
| 502 Bad Gateway | API or frontend not yet healthy — check `docker compose logs api` |
| DB connection failure | `DATABASE_URL` uses `localhost` instead of the `postgres` service name |
| Redis/broker failure | `REDIS_URL` uses `localhost` instead of the `redis` service name |
| Certbot fails | DNS not pointing to this server, or ports 80/443 are blocked |
| Guest authorized but no internet | UniFi external portal URL doesn't match the site's host/scheme |

---

## Maintenance

```bash
# Pull updates, rebuild, and restart
git pull
docker compose up -d --build
docker compose exec api alembic upgrade head

# Stop everything
docker compose down

# WARNING: also deletes database volume
docker compose down -v
```

### Certificate renewals

Certbot is not scheduled automatically. Add a cron job on the host:

```bash
sudo crontab -e
```

```cron
# Weekly renewal attempt — every Sunday at 3 AM
0 3 * * 0 cd /opt/redux-unifi-portal && /usr/bin/docker compose run --rm certbot >> /var/log/certbot_docker.log 2>&1
```
