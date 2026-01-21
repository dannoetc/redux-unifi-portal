# Integrations

This page is the “how it connects” guide — UniFi first, then optional identity providers and email.

If you want the exact API calls (with copy/paste snippets), jump to:
**[UniFi Quick Reference](unifi-quickref.md)**.

---

## UniFi Network API (what we do)

ReduxTC uses the official UniFi Network API to:

- Find the guest’s device (client) by MAC address
- Authorize that guest on the right site
- Apply the site’s default policy (time limits / bandwidth caps)

### UniFi external portal URL

UniFi should point to a single external portal URL, like:

```
https://wifi.reduxtc.com/guest/
```

That’s the whole point: one URL, every site.

When UniFi redirects a guest, it includes parameters like `id` (client MAC) and `ap` (AP MAC). We use those to
resolve the correct tenant/site and then authorize the guest.

### UniFi sends weird URLs sometimes (we handle it)

In the real world, UniFi doesn’t always send a clean URL. You might see things like:

- `/guest?ap=...&id=...`
- `/guest%3Fap=...&id=...` (encoded question mark)
- values that are double-encoded (especially `url=`)

We **don’t get to control what UniFi sends**, so we built the app and nginx to accept the messy versions reliably.

If you’re troubleshooting, the big idea is:
- nginx forwards the *raw* request URI to the backend (`X-Original-URI`)
- backend parses params from both places (encoded fragment + normal querystring) and picks the best values

The full “how we handle it” is in **Operations & Security**.

### Hosted / tenant-mode UniFi controllers

Some UniFi deployments are “tenant-mode” (hosted / multi-tenant UniFi). Those controllers require an extra path segment:

- normal controller: `/v1/sites/{siteId}/...`
- tenant-mode: `/v1/tenants/{tenantId}/sites/{siteId}/...`

You don’t have to memorize this — the rule is simple:

> If the controller config includes a `tenant_id`, we call the tenant-mode endpoints.

If you see “client not found” errors on a hosted controller, this is the first thing to double-check.

---

## Identity providers (OIDC)

OIDC providers enable single sign-on (SSO) for guests (and potentially staff depending on how you deploy).

What to expect:

- Standard redirect/callback flow
- PKCE + state validation
- Optional domain allowlists per site (so only the right users can sign in)

Practical tip: captive portal browsers are limited. If SSO is flaky inside the captive window, we provide an
“Open in browser” fallback so guests can complete sign-in in a normal browser.

---

## Email delivery (OTP)

Email OTP depends on your SMTP provider.

A few real-world tips:

- Use a sender domain you control and set up SPF/DKIM/DMARC so codes don’t land in spam.
- Rate limits apply (by design) to prevent abuse.
- If users report “no code received,” check deliverability first (spam folder, blocks, bounced messages).

---

## Redis and background jobs

We use Redis and background jobs so the portal feels fast and forgiving:

- Portal sessions and OTP codes are cached so reconnects don’t immediately force guests to start over.
- Background jobs handle email sending and other async work.

If Redis is down, OTP and session reuse will feel broken — you’ll see more “start over” behavior.
