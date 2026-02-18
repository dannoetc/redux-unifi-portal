# Admin Console

Use the admin console to manage tenants, sites, guest access methods, and reporting.

Admin URL:
- `https://<your-domain>/admin`

## Layout overview

![Admin dashboard](assets/screenshots/admin-dashboard.png)

Left sidebar navigation:
- `Dashboard`: KPI summary, auth method mix, site performance, and daily trend table
- `Tenants`: customer org records and tenant-level UniFi defaults
- `Sites`: location-level branding, template, policy, UniFi mapping, and SSO toggles
- `Admins`: staff access and roles (superadmin only)
- `OIDC`: tenant OIDC providers
- `Vouchers`: voucher batch generation and export
- `Reports`: method and site trend reports with presets and CSV export
- `Auth Events`: audit trail with filters and CSV export
- `Certificates`: TLS certificate mode and custom cert upload (superadmin only)

## Tenant scope behavior

- Tenant scope is controlled from the sidebar tenant selector.
- The selected tenant persists in the browser.
- Superadmins can switch between selected tenant scope and all-tenant scope where supported.

## Core workflows

1. New customer:
   - Create tenant in `Tenants`
   - Add site(s) in `Sites`
   - Configure UniFi external portal URL
   - Guides: [Tenant Onboarding](tenant-onboarding.md), [Site Setup Checklist](site-setup.md), [UniFi Setup](unifi-setup.md)
2. Enable auth methods:
   - Voucher: [Vouchers](vouchers.md)
   - Email OTP: [Email OTP (SMTP)](email-otp-smtp.md)
   - SSO: [OIDC SSO (Microsoft Entra ID)](oidc-m365.md)
3. Monitor and export:
   - [Auth Events & Reporting](auth-events.md)
4. Manage admin access:
   - [Admin Users & Roles](admin-users.md)
5. Manage TLS certificates:
   - [Certificates & TLS](certificates.md)
