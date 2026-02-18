# Auth Events & Reporting (step-by-step)

Auth Events are your audit trail: who authorized, where, when, and how.
Reports is where you compare trends across methods and sites.

---

## 1) Set scope first (tenant)

1. Choose tenant scope from the **left sidebar tenant selector**.
2. If you are a superadmin, use **Selected tenant / All tenants** scope toggles where available.

---

## 2) Auth Events workflow

1. Go to **Admin → Auth Events**
2. Use filters:
   - **Method**
   - **Result**
   - **Site**
   - **Search** (guest identity, failure reason, session/identity IDs)
3. Use **Rows** + **Previous/Next** to page through large datasets.
4. Use **Refresh** if you need a live reload after troubleshooting.

Auth Events table includes:
- method (`voucher`, `email_otp`, `oidc`, `tos_only`)
- result (`success`/`fail`)
- timestamp
- site
- reason (when present)

---

## 3) Reports workflow

1. Go to **Admin → Reports**
2. Apply filters:
   - period (7/30/90 days)
   - site
   - method
3. Optionally save reusable filter sets with **Save preset**.
4. Review:
   - **Method Daily Trend**
   - **Site Comparison**
5. Use table pagination controls for long windows.
6. Export CSV from each report card.

---

## 4) Export CSV

1. Apply the filters you want.
2. Click **Export CSV** on Auth Events, Method Daily Trend, or Site Comparison.

Use this for:
- customer reporting
- compliance record keeping
- debugging “it didn’t work” claims

---

## 5) Troubleshooting workflow (fast)

When someone says “my guest couldn’t get on WiFi”:

1. Go to **Auth Events**
2. Search guest email (OTP/SSO), reason, or session ID
3. Click into the related site and verify:
   - UniFi site id
   - UniFi connectivity (base URL / API key)
   - OIDC settings (if SSO)
   - SMTP settings (if OTP)
4. Use **Reports** to confirm issue pattern (single site vs all sites, single method vs global).
