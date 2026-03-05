# Initial Setup Wizard

The Setup Wizard is the first-run flow that creates your initial platform records:

- first `Superadmin`
- first `Tenant`
- optional first `Site`

It is available only before bootstrap is complete.

---

## When this page is available

`/setup` is available only when no superadmin exists yet.

- Before bootstrap: `/setup` loads the wizard.
- After bootstrap: `/setup` and `/admin/login` redirect to normal admin login flow.

---

## Wizard steps

1. Open `https://<your-domain>/setup`
2. Enter:
   - initial superadmin email + password
   - initial tenant name + slug
3. Optional: enable `Create initial site` and enter:
   - site slug + display name
   - UniFi site ID (often `default`)
   - UniFi base URL / port / API key
4. Click `Complete setup`

On success, the backend creates records and signs in the new superadmin session.

---

## Optional env-based prefill

You can prefill wizard defaults through `.env`:

```env
SETUP_DEFAULT_ADMIN_EMAIL=
SETUP_DEFAULT_TENANT_NAME=
SETUP_DEFAULT_TENANT_SLUG=
SETUP_DEFAULT_SITE_SLUG=
SETUP_DEFAULT_SITE_DISPLAY_NAME=
SETUP_DEFAULT_UNIFI_BASE_URL=
SETUP_DEFAULT_UNIFI_PORT=443
```

These values only prefill form fields. They do not create records by themselves.

---

## Rate limit controls

Setup bootstrap requests are rate-limited by IP:

```env
SETUP_BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS=60
SETUP_BOOTSTRAP_RATE_LIMIT_PER_IP=5
```

Tune these if you are deploying behind strict proxies or shared NAT.

---

## API behavior (for automation checks)

- `GET /api/setup/status`
  - returns `bootstrapped: false|true`
- `POST /api/setup/bootstrap`
  - creates the first superadmin/tenant/(optional site)
  - returns `409 BOOTSTRAP_ALREADY_COMPLETED` if setup already ran

---

## Fallback: non-interactive seed script

For scripted environments, you can still initialize via CLI seed:

```bash
docker compose run --rm api sh -c '\
  SUPERADMIN_EMAIL=you@example.com \
  SUPERADMIN_PASSWORD=change-me \
  TENANT_SLUG=acme \
  TENANT_NAME="Acme MSP" \
  SITE_SLUGS=lab \
  SITE_DISPLAY_NAMES="Lab" \
  SITE_UNIFI_SITE_IDS=default \
  UNIFI_BASE_URL=https://unifi.example.com \
  UNIFI_API_KEY=replace-with-unifi-api-key \
  python -m app.scripts.seed'
```

Use either seed or setup wizard first. Once a superadmin exists, bootstrap is considered complete.
