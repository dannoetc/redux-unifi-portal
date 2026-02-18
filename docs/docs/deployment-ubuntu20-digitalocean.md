# Production Deployment (Ubuntu 20.04 / DigitalOcean)

This is the **end-to-end** guide to deploy the portal on a **Ubuntu 20.04** DigitalOcean droplet using the repo’s **Docker + nginx + Certbot** configuration.

This assumes you want a single public domain like:

- `wifi.example.com` → portal + admin UI + docs

---

## 0) What you need before you touch the server

1. A **domain name** you control.
2. A **DNS A record** pointing your domain to the droplet’s public IP.

   Example:
   - Name: `wifi`
   - Type: `A`
   - Value: `<your-droplet-public-ip>`

3. A real **email address** for Let’s Encrypt expiration notices.

---

## 1) Create the droplet (DigitalOcean)

Recommended minimum:
- Ubuntu 20.04
- 2 vCPU / 2 GB RAM (or higher)
- 25+ GB disk

Also:
- Add your SSH key
- Enable backups if you want “easy button” recovery

---

## 2) SSH in and do basic hardening

```bash
ssh root@<your-droplet-ip>
```

(Optional but strongly recommended)
```bash
apt-get update
apt-get install -y ufw

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
ufw status
```

---

## 3) Install Docker Engine + Docker Compose plugin

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

echo   "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu   $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |   tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker version
docker compose version
```

If you want to run Docker as a non-root user:

```bash
usermod -aG docker <your-user>
```

Log out and back in, or run:

```bash
newgrp docker
```

---

## 4) Clone the repo

```bash
cd /opt
git clone <this-repo-url> redux-unifi-portal
cd redux-unifi-portal
```

---

## 5) Create `.env` for production

```bash
cp .env-sample .env
nano .env
```

Minimum required settings:

```bash
DOMAIN=wifi.example.com
LETSENCRYPT_EMAIL=ops@example.com

BASE_URL=https://wifi.example.com
NEXT_PUBLIC_API_BASE_URL=https://wifi.example.com

# MUST be a long random value
SECRET_KEY=change-me
```

Recommended:
- Set `UNIFI_VERIFY_SSL=false` if your UniFi controller has a self-signed or private CA cert.
- If you’re using OTP email, configure SMTP values (see **Email OTP (SMTP)** doc).

---

## 6) Start the stack with nginx + Certbot

This repo uses two compose files:
- `docker-compose.yml` (full stack)
- `docker-compose.nginx-certbot.yml` (production behavior for nginx/certbot)

Run:

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx-certbot.yml up -d --build
```

Check containers:

```bash
docker compose ps
```

---

## 7) Confirm Let’s Encrypt issued the certificate

Tail Certbot logs:

```bash
docker compose -f docker-compose.yml -f docker-compose.nginx-certbot.yml logs -f certbot
```

What “good” looks like:
- first run requests the cert
- then it enters the renewal loop (every ~12 hours)

If issuance fails:
- DNS A record is wrong or not propagated
- ports 80/443 are blocked
- `DOMAIN` in `.env` does not match the hostname you’re using

---

## 8) Run database migrations

```bash
docker compose exec api alembic upgrade head
```

---

## 9) Create your first tenant/site + superadmin

Use the seed script (you can run it multiple times; it will error if you re-use unique slugs/emails).

```bash
docker compose exec -e SUPERADMIN_PASSWORD='change-me'   -e TENANT_SLUG='acme'   -e TENANT_NAME='Acme MSP'   -e SITE_SLUGS='lab,office'   -e SITE_DISPLAY_NAMES='Lab,Office'   -e SITE_UNIFI_SITE_IDS='default,default'   -e UNIFI_BASE_URL='https://unifi.example.com'   -e UNIFI_API_KEY='replace-with-unifi-api-key'   api python -m app.scripts.seed
```

Notes:
- `SUPERADMIN_EMAIL` defaults to **jhalon@reduxtc.com**
- To override it: add `-e SUPERADMIN_EMAIL='you@example.com'`

---

## 10) Verify it’s working

Open:
- Admin: `https://wifi.example.com/admin`
- Docs: `https://wifi.example.com/docs/`
- Guest portal entrypoint: `https://wifi.example.com/guest/`

Health checks:
```bash
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f frontend
```

---

## 11) UniFi controller configuration (minimum)

In UniFi:
- Hotspot / Captive portal: enable “external portal server”
- External portal URL:

```text
https://wifi.example.com/guest/
```

Then finish the UniFi-side setup: **[UniFi Setup](unifi-setup.md)**.

---

## 12) Backups and updates

### Back up Postgres
Postgres data is stored in a Docker named volume: `postgres_data`.

Quick manual dump:

```bash
docker compose exec postgres pg_dump -U postgres redux_portal > backup.sql
```

### Update the app
```bash
cd /opt/redux-unifi-portal
git pull
docker compose -f docker-compose.yml -f docker-compose.nginx-certbot.yml up -d --build
docker compose exec api alembic upgrade head
```

---

## 13) Common failure modes

### Certbot can’t issue
- Confirm DNS: `dig wifi.example.com +short`
- Confirm ports open: `ufw status`
- Confirm nginx is reachable: `curl -I http://wifi.example.com`

### 502 / bad gateway
- API not started yet: `docker compose logs -f api`
- Frontend not started yet: `docker compose logs -f frontend`

### Can’t connect to UniFi
- Confirm base URL, port, and API key for the tenant/site
- If self-signed SSL: set `UNIFI_VERIFY_SSL=false`
