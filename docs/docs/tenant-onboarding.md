# Tenant Onboarding (step-by-step)

This is the **do-this-in-order** guide for creating a new customer tenant in the Admin UI.

You’ll do two things:
1) Create a **tenant** (the customer org)  
2) Create **sites** under that tenant (the customer locations)

---

## 0) What you need before you click anything

- The customer’s **tenant name** (e.g., “Acme Schools”)
- The **tenant slug** you want (short + URL-safe, e.g., `acme`)
- UniFi controller details (at least one of these must be set somewhere):
  - UniFi **base URL** (example: `https://unifi.example.com`)
  - UniFi **port** (usually `443`)
  - UniFi **API key** (or an API key reference)

---

## 1) Pick the tenant you’re working on (important)

1. Go to **Admin → Tenants**
2. Use the tenant selector (top bar) to confirm you’re editing the right tenant.

---

## 2) Create the tenant

1. Go to **Admin → Tenants**
2. Click **New tenant**
3. Fill out:
   - **Name** (human-friendly)
   - **Slug** (URL-safe identifier)
   - **Status** (leave default unless you have a reason)

4. (Recommended) Set UniFi defaults at the tenant level:
   - **UniFi base URL**
   - **UniFi port**
   - **UniFi API key** (paste) OR **UniFi API key ref** (reference to a secret)

> Tenant-level UniFi settings are used as defaults. You can override them per site later.

---

## 3) Create at least one site under the tenant

1. Go to **Admin → Sites**
2. Click **New site**
3. Fill out:
   - **Display name** (what admins see)
   - **Slug** (URL-safe identifier)
   - **Enabled** (leave enabled)
   - **UniFi site id** (this must match the UniFi “site” identifier — commonly `default`)

4. Optional but common:
   - Branding: **Logo URL**, **Primary color**
   - Policy defaults: **Time limit**, **Bandwidth caps**, etc.

---

## 4) Set UniFi controller connection for the site (if needed)

On the site page, set any overrides if this site uses a different controller:

- **UniFi base URL** (optional override)
- **UniFi port** (optional override)
- **UniFi API key** (optional override)

Rules:
- If the site fields are blank, the portal falls back to the tenant’s UniFi settings.
- If both are blank, guests **cannot** be authorized.

---

## 5) Verify (fast sanity check)

1. Go to **Admin → Sites**
2. Open the site you just created
3. Confirm:
   - UniFi settings are present (site or tenant)
   - `UniFi site id` is correct

Next steps:
- Configure UniFi external portal URL: **[UniFi Setup](unifi-setup.md)**
- Enable authentication options (vouchers, OTP, SSO) per site:
  - Vouchers: **[Vouchers](vouchers.md)**
  - Email OTP: **[Email OTP (SMTP)](email-otp-smtp.md)**
  - SSO: **[OIDC SSO (Microsoft Entra ID)](oidc-m365.md)**
