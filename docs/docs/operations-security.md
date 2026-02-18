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

The platform enforces Redis-backed rate limits for:
- admin login (per IP and per email fingerprint)
- OTP start/verify
- voucher redemption attempts

If many valid users are rate-limited, check for captive-browser redirect loops.

## Admin session security

- Admin auth uses a signed session cookie (`admin_session`).
- Cookie is `HttpOnly` and `SameSite=Lax`.
- Session lifetime is controlled by `ADMIN_SESSION_MAX_AGE_SECONDS`.
- In production, set `ADMIN_SESSION_COOKIE_SECURE=true` so cookies are HTTPS-only.

## Browser and edge hardening

Current deployment applies browser security headers:
- `Content-Security-Policy`
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=()`

On HTTPS listeners, nginx also sets:
- `Strict-Transport-Security` (`max-age=31536000; includeSubDomains`)

## Logging

Operational logs should include tenant, site, method, and result fields without exposing secrets.

Use `Auth Events` as source of truth for "guest could not connect" reports.

## Secret handling

Never hardcode:
- UniFi API keys
- SMTP credentials
- OIDC client secrets

Current behavior:
- Secret values can be stored encrypted at rest (requires `SECRETS_ENCRYPTION_KEY`).
- Secret references (`*_ref`) can point to env-backed values.
- If encryption key is missing/invalid, encrypted secret operations fail safely.

In production, use a secret manager and env references.

## Input sanitization controls

- Guest portal custom HTML is sanitized server-side before storage/use.
- Redirect URLs are sanitized and constrained to safe schemes/relative paths.
- UniFi redirect parsing handles malformed/encoded inputs defensively.

## TLS baseline

- enforce HTTPS for guest and admin URLs
- keep certificates valid and monitor expiration
- verify UniFi external portal URL exactly matches production host/scheme
- TLS mode supports both Let's Encrypt and validated custom certificate/key upload
