# Admin Users & Roles (step-by-step)

This is how you give staff access to the Admin Console.

---

## Roles (what they can do)

- **Tenant Admin**
  - Can manage sites, vouchers, OIDC settings, and view/export auth events for their tenant.

- **Tenant Viewer**
  - Read-only access for their tenant (view sites and auth events, export reports).

- **Superadmin** (flag)
  - Can access **all tenants** and platform-wide settings.

---

## Create an admin user

1. Go to **Admin → Admins**
2. Confirm you’ve selected the right tenant in the top bar.
3. Click **New admin**
4. Fill in:
   - **Email**
   - **Password** (minimum 8 characters)
   - **Role** (Tenant Admin or Tenant Viewer)
5. Click **Create**

---

## Edit an admin user

1. Go to **Admin → Admins**
2. Click the row menu for the user
3. Update:
   - Email
   - Role
   - Superadmin flag (if you have permission)
   - Password (optional)
4. Save changes

---

## Remove access

To remove access, delete the user from **Admin → Admins** (or set their role to the least privileged role you support operationally).

Tip: if you’re offboarding someone, rotate shared secrets too (UniFi keys, SMTP creds, etc.).
