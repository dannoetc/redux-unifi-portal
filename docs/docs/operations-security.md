# Operations & Security

This section highlights operational considerations and built-in controls.

## Tenant isolation

- Each tenant’s data is isolated by tenant and site identifiers.
- Admin access is scoped to assigned tenants unless superadmin privileges apply.

## Data handling

- The portal stores only the minimal data needed for guest access.
- Guest MAC addresses are retained for authorization and audit trails.
- Email addresses are collected only for OTP or SSO flows.

## Reliability safeguards

- Portal sessions are cached to handle reconnects without re-authentication.
- Duplicate portal requests are safely handled to prevent double authorizations.

## Rate limiting and reliability

- OTP and voucher endpoints are rate-limited to prevent abuse.
- Portal sessions are cached for fast re-authorization when guests reconnect.

## Logging and audit trails

- Authorization events are logged with tenant, site, and method details.
- Exports are available for compliance and reporting needs.

## Recommended operating practices

- Use HTTPS and keep certificates up to date.
- Limit admin access to trusted staff.
- Review auth event exports regularly for unusual activity.
- Monitor SMTP deliverability to avoid OTP failures.
