# Auth Events & Reporting (idiot-proof)

Auth Events are your audit trail: who authorized, where, when, and how.

---

## View events

1. Go to **Admin → Auth Events**
2. Confirm the correct tenant is selected in the top bar.

You’ll see a table of events with:
- method (voucher, email_otp, oidc, tos_only)
- result (success/failure)
- timestamps
- optional portal session / identity ids

---

## Filter events

On the Auth Events page you can filter by:

- **Method**
- **Result**
- **Search** (email, display name, failure reason, or paste a UUID for portal session / identity)

There’s also a **Site** selector in the UI (handy when your tenant has many sites).

---

## Export CSV

1. Apply any filters you want
2. Click **Export CSV**

Use this for:
- customer reporting
- compliance record keeping
- debugging “it didn’t work” claims

---

## Troubleshooting workflow (fast)

When someone says “my guest couldn’t get on WiFi”:

1. Go to **Auth Events**
2. Search the guest’s email (OTP/SSO) or the failure reason
3. Click into the related site and verify:
   - UniFi site id
   - UniFi connectivity (base URL / API key)
   - OIDC settings (if SSO)
   - SMTP settings (if OTP)
