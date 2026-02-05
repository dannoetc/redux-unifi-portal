# Admin Console

The admin console is where MSP operators and tenant admins configure guest access, sites, and reporting.

Admin URL:
- `https://<your-domain>/admin`

---

## Admin UI map (what’s where)

Left sidebar:

- **Dashboard** — quick links and status
- **Tenants** — create/edit tenants + default UniFi controller config
- **Sites** — create/edit sites + branding/policies + UniFi site mapping
- **Admins** — create/edit admin users and roles
- **OIDC** — create/edit OIDC providers (tenant-scoped)
- **Vouchers** — generate voucher batches and export to CSV
- **Auth Events** — audit trail + export CSV

---

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
- Auth Events table + export CSV  
  → **[Auth Events & Reporting](auth-events.md)**

### Staff access control
- Create admins, set roles, grant superadmin when needed  
  → **[Admin Users & Roles](admin-users.md)**

---

## Notes on tenant isolation

- Data is scoped by **tenant** and **site**
- Admin access is limited to assigned tenant(s) unless you’re a superadmin

See: **[Operations & Security](operations-security.md)**
