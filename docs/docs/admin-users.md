# Admin Users & Roles

Use this page to grant or revoke staff access to the admin console.

## Role model

- `Tenant Admin`: manage sites, vouchers, OIDC, and reporting for assigned tenant(s)
- `Tenant Viewer`: read-only access for assigned tenant(s)
- `Superadmin`: full platform access across all tenants

## Create an admin user

1. Open `Admin -> Admins`.
2. Use the top tab for the user type:
   - `Tenant Admins`: tenant-scoped admin/viewer users
   - `Superadmins`: platform-wide administrators
3. For tenant admins, confirm the tenant selector is set correctly.
4. Click `New admin` (tenant tab) or `New superadmin` (superadmin tab).
5. Enter email, password, and role (where applicable).
6. Save.

![Admin users page](assets/screenshots/admin-users.png)

## Edit an existing admin

1. In `Admin -> Admins`, select `Edit`.
2. Update email/role as needed.
3. To rotate credentials, use `Reset password`.
4. Save.

Superadmin status is managed on the dedicated `Superadmins` tab.

## Remove access

1. In `Admin -> Admins`, select `Remove`.
2. Confirm deletion.

Safety guards:
- You cannot remove your own superadmin account from this UI.
- The platform prevents deleting the last remaining superadmin.

Operational note:
If you remove privileged staff, rotate shared credentials (UniFi key, SMTP secret, OIDC client secret).
