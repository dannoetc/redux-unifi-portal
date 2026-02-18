# Operations & Security

Use this page for day-2 operations and security guardrails.

## Tenant isolation

- Every record is tenant or site scoped.
- Admin access is limited to assigned tenants unless `superadmin`.

## Data minimization

Stored:
- MAC address (required for authorize/audit)
- email only for OTP/SSO flows
- auth event metadata for reporting

Avoid collecting unnecessary personal data.

## Reliability behavior

- active portal sessions are cached to reduce guest retries
- duplicate portal requests are handled idempotently
- UniFi client lookup uses retry/backoff for association race conditions

## UniFi redirect edge cases

UniFi may send encoded or malformed redirect URLs.

Required contract:
1. nginx forwards raw request URI as `X-Original-URI`
2. backend parses both encoded fragments and querystring safely

If site resolution fails, inspect original URI and parsed params first.

## Rate limits

OTP and voucher endpoints are rate-limited.

If many valid users are rate-limited, check for captive-browser redirect loops.

## Logging

Operational logs should include tenant, site, method, and result fields without exposing secrets.

Use `Auth Events` as source of truth for "guest could not connect" reports.

## Secret handling

Never hardcode:
- UniFi API keys
- SMTP credentials
- OIDC client secrets

In production, use a secret manager and env references.

## TLS baseline

- enforce HTTPS for guest and admin URLs
- keep certificates valid and monitor expiration
- verify UniFi external portal URL exactly matches production host/scheme
