# Operations & Security

This page is the “keep it running” guide: what we store, what we don’t, and how to troubleshoot the common issues.

---

## Tenant isolation (what it means here)

- Data is always scoped by **tenant** and **site**.
- Admin access is limited to assigned tenant(s), unless you’re a superadmin.

In practice, this means one tenant can’t see another tenant’s sites, vouchers, or audit trail.

---

## What data we store (and what we avoid)

We intentionally keep data minimal:

- **Guest MAC addresses** — needed for authorization + auditing.
- **Email addresses** — only collected when the guest uses Email OTP or SSO.
- **Auth events** — tenant/site + method + timestamps so you can audit and export.

We do **not** want to store extra identity info “just because.”

---

## Reliability & “don’t make guests start over”

Captive portals are messy. Guests reconnect, captive browsers time out, and UniFi may bounce them through the portal more than once.

To keep things smooth:

- Portal sessions are cached so a guest doesn’t have to re-auth every time they reconnect.
- Duplicate requests are handled safely (we don’t double-authorize or create duplicate sessions).
- We retry UniFi lookups a few times with short backoff to handle controller hiccups.

---

## UniFi redirect weirdness (the one that bites everyone)

UniFi sometimes sends the external portal redirect in an encoded or malformed form, like:

- `/guest%3Fap=...&id=...`
- `url=` values that are double-encoded

We can’t fix UniFi — we can only accept it.

### The contract

1) **nginx forwards the raw request URI** (percent-encoding intact):

Add this header for guest routes:

```nginx
proxy_set_header X-Original-URI $request_uri;
```

2) **backend parses parameters defensively**:
- If it sees `/guest%3F...`, it parses the part after `%3F` as key/value params
- It also parses the normal query string
- It merges them and normalizes MAC addresses

If you’re diagnosing “why did it fail to resolve the site?”, start by logging `X-Original-URI` and the parsed params map.

---

## Rate limits (abuse prevention)

- OTP and voucher endpoints are rate-limited to prevent hammering.
- If a legit guest gets rate limited, that’s a signal to look for looping captive browser behavior or a misconfigured redirect.

---

## Logging & audit trail

- Every authorization event includes tenant + site + method.
- Exports exist so MSPs can keep compliance records.

Operational tip: if you’re chasing a “guest says it didn’t work” report, the auth events view is your truth source.

---

## Secrets & configuration

Basic rule: **don’t bake secrets into code**.

- UniFi API keys
- SMTP credentials
- OIDC client secrets
- Any signing keys / peppers

In dev, `.env` is fine. In prod, store secrets in your secret manager and reference them via env vars.

---

## TLS / HTTPS

Use HTTPS for the portal. Captive portals and redirects behave better when everything is cleanly HTTPS.

- Keep certs current
- Validate the external portal URL in UniFi uses the same scheme/host you expect

---

## Quick troubleshooting

### “Site not found” / “client not found”
- Check you’re calling the right UniFi endpoint shape:
  - hosted/tenant-mode controllers require `/v1/tenants/{tenantId}/...`
- Confirm the client MAC is normalized (format differences matter)
- Check UniFi has the client in its “clients” list (sometimes you need a brief delay after association)

### OTP emails not arriving
- Check deliverability (SPF/DKIM/DMARC)
- Check SMTP blocks from the hosting environment
- Check rate limits (looping can trigger it)

### Guests stuck in captive portal loop
- Usually a UniFi config mismatch (wrong external portal URL, wrong Hotspot config)
- Or the device is failing to open the captive assistant (iOS/macOS can be picky). Suggest “Open in browser.”

---

## If you need the exact UniFi API calls
Go to: **[UniFi Quick Reference](unifi-quickref.md)**.
