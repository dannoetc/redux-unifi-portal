# Integrations

This page explains how ReduxTC connects to external systems.

## UniFi integration

ReduxTC uses the official UniFi Network API to:
- resolve a connected client by MAC
- authorize guest access on the mapped site
- apply the configured policy defaults

Configure UniFi to send guests to one URL:

```text
https://<your-domain>/guest/
```

Then ReduxTC resolves the correct tenant/site from UniFi redirect parameters.

Detailed setup:
- [UniFi Setup](unifi-setup.md)
- [UniFi Quick Reference](unifi-quickref.md)

## OIDC providers

OIDC providers allow SSO guest login.

Expected behavior:
- standard redirect/callback flow with state validation
- optional allowed-domain enforcement per site
- captive-browser fallback via `Open in browser`

Setup guide:
- [OIDC SSO (Microsoft Entra ID)](oidc-m365.md)

## SMTP for email OTP

Email OTP delivery uses SMTP.

Recommended baseline:
- SPF, DKIM, and DMARC configured for sender domain
- relay reachable from backend host
- Celery worker running

Setup guide:
- [Email OTP (SMTP)](email-otp-smtp.md)

## Redis and background jobs

Redis stores short-lived session and OTP state.

If Redis is unavailable, expect OTP errors and poor reconnect behavior.
