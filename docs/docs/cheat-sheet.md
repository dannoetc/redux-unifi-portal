# ReduxTC Portal Cheat Sheet (step-by-step)

This is the **one-page, do-this-in-order** guide to get the portal running **in production** on a Linux server using the repo’s Docker setup (nginx + Certbot included).

If you want the longer “why/how” doc, see: **[Production Deployment (Ubuntu 20.04 / DigitalOcean)](deployment-ubuntu20-digitalocean.md)**.

---

## 0) You need these 3 things first

1. A **Ubuntu 20.04** server with public IP (DigitalOcean droplet is fine)
2. A DNS **A record** pointing your domain to that server (example: `wifi.example.com`)
3. A real email for Let’s Encrypt (example: `ops@example.com`)

---

## 1) SSH in and install Docker + Compose

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo   "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu   $(. /etc/os-release && echo "$VERSION_CODENAME") stable" |   sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

sudo usermod -aG docker $USER
newgrp docker
docker version
docker compose version
```

---

## 2) Get the repo on the server

```bash
cd ~
git clone <this-repo-url> redux-unifi-portal
cd redux-unifi-portal
```

---

## 3) Create your `.env`

```bash
cp .env-sample .env
nano .env
```

Fill in **at least**:

- `DOMAIN=wifi.example.com`
- `LETSENCRYPT_EMAIL=ops@example.com`
- `BASE_URL=https://wifi.example.com`
- `NEXT_PUBLIC_API_BASE_URL=https://wifi.example.com`
- `SECRET_KEY=<long-random-string>`

If you don’t know what a variable is, leave it as-is for now.

---

## 4) Build and start everything (including nginx + Certbot)

```bash
docker compose up -d --build
```

Issue certificate once:

```bash
docker compose run --rm certbot
```

---

## 5) Run database migrations

```bash
docker compose exec api alembic upgrade head
```

---

## 6) Complete initial setup wizard

Open `https://wifi.example.com/setup` and complete:

- initial superadmin
- initial tenant
- optional initial site

See [Initial Setup Wizard](setup-wizard.md) for env prefill options and seed-script fallback.

---

## 7) Log in

- Admin: `https://wifi.example.com/admin`
- Docs: `https://wifi.example.com/docs/`
- Guest portal entrypoint (UniFi external portal URL): `https://wifi.example.com/guest/`

---

## 8) If something doesn’t work

```bash
docker compose ps
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f frontend
```

Common issues:
- **Certbot can’t issue** → DNS not pointing to the server, ports 80/443 blocked, wrong `DOMAIN`.
- **502 from nginx** → API/frontend not healthy yet; check logs.
- **DB errors** → Postgres not up; run `docker compose logs -f postgres`.

---
