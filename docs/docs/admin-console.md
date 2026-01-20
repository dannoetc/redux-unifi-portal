# Admin Console

The admin console is where MSP operators and tenant admins configure guest access, sites, and
reporting. Access is scoped to the tenant(s) you belong to.

## Tenants and sites

- **Tenants** represent customer organizations.
- **Sites** are the physical or logical locations under a tenant.
- Each site stores branding and UniFi policy defaults for guest sessions.

## Admin roles

- **Superadmins** can manage all tenants and platform settings.
- **Tenant admins** can configure sites, authentication methods, and reporting for their tenant.

## Site configuration

Administrators can configure per-site settings including:

- **Portal branding** (logo and colors).
- **Guest policy defaults** such as time limits and bandwidth caps.
- **Custom portal HTML** (optional), with the built-in portal injected at `{{portal}}`.

## Authentication methods

Each site can enable one or more methods:

- **Voucher codes** for staff-issued guest access.
- **Email OTP** for verified email-based access.
- **OIDC SSO** for enterprise or school identity providers.
- **TOS-only access** for frictionless onboarding.

## Voucher management

- Create **voucher batches** with optional expiration and usage limits.
- Export voucher codes to CSV for printing or distribution.
- Track voucher redemption history.

## OIDC provider management

- Configure identity providers (issuer, client ID, scopes).
- Enable providers per site with optional domain restrictions.

## Auth events and auditing

- View guest authorization events per tenant/site.
- Filter events by site, method, and time range.
- Export audit logs to CSV for reporting.

## Common admin workflows

1. **Create a tenant and site** for each customer location.
2. **Configure UniFi settings** and a default access policy for the site.
3. **Enable authentication methods** and set branding/terms for the guest portal.
4. **Issue vouchers or configure SSO** depending on guest access needs.
5. **Monitor auth events** to validate usage and detect issues.
