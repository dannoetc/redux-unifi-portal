# Troubleshooting (step-by-step)

This is the “what do I check first?” page.

---

## Basic commands

```bash
docker compose ps
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f celery
docker compose logs -f postgres
```

---

## Problem: Certbot / HTTPS is broken

Symptoms:
- browser warns about cert
- Certbot logs show failures
- `http://` works but `https://` doesn’t

Checklist:
1. DNS A record points to this server:
   ```bash
   dig <your-domain> +short
   ```
2. Ports 80/443 allowed:
   ```bash
   sudo ufw status
   ```
3. DOMAIN matches the hostname in `.env`
4. Tail certbot logs:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.nginx-certbot.yml logs -f certbot
   ```

---

## Problem: Guests see portal but never get access

This is almost always UniFi connectivity.

Checklist:
- Site has **UniFi site id**
- Tenant or site has UniFi **base URL** and **API key**
- If controller uses self-signed TLS, set `UNIFI_VERIFY_SSL=false`
- Check API logs for errors on authorize:
  ```bash
  docker compose logs -f api
  ```

---

## Problem: “Site not found” / wrong site branding

Checklist:
- You created the site in the expected tenant
- UniFi external portal URL is correct (`/guest/`)
- In the UI, confirm site slug + tenant slug are correct
- Look for UniFi weird encoding issues in logs (see Operations & Security)

---

## Problem: Email OTP doesn’t send

Checklist:
- Celery worker running:
  ```bash
  docker compose ps
  ```
- Celery logs:
  ```bash
  docker compose logs -f celery
  ```
- SMTP host reachable from server (and not blocked by hosting)

---

## Problem: OIDC fails

Start with:
- Redirect URI mismatch (most common)
- Issuer wrong
- Missing client secret
- Missing email claim if you enforce allowed domains

See: **[OIDC SSO (Microsoft Entra ID)](oidc-m365.md)**
