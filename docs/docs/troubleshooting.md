# Troubleshooting

Use this page as first-response runbook.

## Quick commands

```bash
docker compose ps
docker compose logs -f nginx
docker compose logs -f api
docker compose logs -f frontend
docker compose logs -f celery
docker compose logs -f postgres
```

## HTTPS or certificate issues

Check:
1. DNS A record points to the correct host.
2. Ports `80` and `443` are open.
3. `DOMAIN` in `.env` matches requested hostname.
4. certbot logs:

```bash
docker compose logs -f certbot
```

## Portal loads but guest not authorized

Usually UniFi configuration mismatch.

Verify:
- site has correct `UniFi site id`
- tenant/site UniFi key and base URL exist
- API logs for authorize failures

## Wrong site branding or site not found

Verify:
- tenant and site slugs
- UniFi external portal URL is `/guest/`
- redirected URI parsing behavior (see Operations & Security)

## OTP failures

Verify:
- `celery` service is running
- SMTP relay reachable from backend
- deliverability records are configured

## OIDC failures

Most common:
- redirect URI mismatch
- wrong issuer
- invalid/missing client secret
- missing email claim for domain filtering

Guide: [OIDC SSO (Microsoft Entra ID)](oidc-m365.md)
