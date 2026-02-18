# Admin Console

The admin console is where MSP operators and tenant admins configure guest access, sites, and reporting.

Admin URL:
- `https://<your-domain>/admin`

---

## Admin UI map (what’s where)

Left sidebar:

- **Dashboard** — auth/usage KPIs, method mix, site performance, and daily traffic
- **Tenants** — create/edit tenants + default UniFi controller config
- **Sites** — create/edit sites + branding/policies + UniFi site mapping
- **Admins** — create/edit admin users and roles
- **OIDC** — create/edit OIDC providers (tenant-scoped)
- **Vouchers** — generate voucher batches and export to CSV
- **Reports** — saved filter presets + method/site comparison exports
- **Auth Events** — audit trail + export CSV + pagination

---

## Tenant selection behavior

- Tenant scope is controlled from the **left sidebar Tenant selector**.
- The console remembers the last selected tenant in your browser.
- If no tenants exist, pages show a guided onboarding state with a direct **Create tenant** action.

## Common workflows (with the right docs)

### Create a new customer
1. Create tenant + default UniFi controller config  
   → **[Tenant Onboarding](tenant-onboarding.md)**

2. Create site(s) + UniFi site id mapping + branding/policies  
   → **[Site Setup Checklist](site-setup.md)**

3. Configure UniFi captive portal external URL  
   → **[UniFi Setup](unifi-setup.md)**

### Enable guest authentication
- Vouchers → **[Vouchers](vouchers.md)**
- Email OTP → **[Email OTP (SMTP)](email-otp-smtp.md)**
- Microsoft SSO (OIDC) → **[OIDC SSO (Microsoft Entra ID)](oidc-m365.md)**

### Audit and reporting
- Dashboard, Reports, and Auth Events all support long-list pagination and filter persistence.
- Auth Events + Reports support CSV export.  
  → **[Auth Events & Reporting](auth-events.md)**

### Staff access control
- Create admins, set roles, grant superadmin when needed  
  → **[Admin Users & Roles](admin-users.md)**

---

## Notes on tenant isolation

- Data is scoped by **tenant** and **site**
- Admin access is limited to assigned tenant(s) unless you’re a superadmin

See: **[Operations & Security](operations-security.md)**
