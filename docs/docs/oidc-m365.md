# OIDC SSO per Tenant/Site (Microsoft Entra ID / M365) — step-by-step

This is the **do-this-in-order** guide to enable Microsoft SSO (OIDC) for a tenant/site.

You will:
1) Create an **App Registration** in Microsoft Entra ID (Azure AD)  
2) Create an **OIDC Provider** in the portal (tenant-scoped)  
3) Enable OIDC on a **site** and test login  

---

## 0) Before you start

You must have:
- A working portal domain (HTTPS): `https://wifi.example.com`
- Admin console access: `https://wifi.example.com/admin`
- Your target **tenant slug** and **site slug** (you can see/edit these in the UI)

Where to find slugs:
- Tenant slug: **Admin → Tenants** (slug field)
- Site slug: **Admin → Sites** (slug field)

---

## 1) Create the App Registration in Microsoft Entra ID

In the Microsoft admin portal:

1. Go to **Entra ID → App registrations**
2. Click **New registration**
3. Set:
   - **Name**: `ReduxTC WiFi Portal - <Tenant Name>`
   - **Supported account types**: usually “Accounts in this organizational directory only” (single tenant)

4. Click **Register**

Copy these values (you will paste them into the portal UI):
- **Application (client) ID**
- **Directory (tenant) ID**

---

## 2) Add a redirect URI (this is the #1 place people mess up)

In the App Registration:

1. Go to **Authentication**
2. Click **Add a platform**
3. Choose **Web**
4. Add this Redirect URI (replace slugs):

```text
https://wifi.example.com/api/oidc/callback/<tenant-slug>/<site-slug>
```

Example:

```text
https://wifi.example.com/api/oidc/callback/acme/lab
```

Save.

If you enable OIDC on multiple sites, add **one redirect URI per site**.

---

## 3) Create a client secret

1. Go to **Certificates & secrets**
2. Click **New client secret**
3. Choose an expiration
4. Copy the secret **value** immediately (you won’t see it again)

---

## 4) Make sure the ID token contains an email claim

The portal uses `email` when enforcing allowed domains.

1. Go to **Token configuration**
2. Click **Add optional claim**
3. Choose **ID token**
4. Add **email**
5. Save

If you skip this:
- SSO can still work, but domain restrictions won’t (and you may not see email in audit logs)

---

## 5) Create the OIDC Provider in the portal (tenant-scoped)

In the portal Admin UI:

1. Go to **Admin → OIDC**
2. Select the correct tenant in the top bar
3. Click **New provider**
4. Fill out:

- **Issuer**
  - Use the v2.0 issuer for your Entra tenant:
  ```text
  https://login.microsoftonline.com/<directory-tenant-id>/v2.0
  ```

- **Client ID**
  - Paste the Application (client) ID

- **Client secret**
  - Paste the secret value you created

- **Scopes**
  - Use:
  ```text
  openid profile email
  ```

5. Save

---

## 6) Enable OIDC on a site

1. Go to **Admin → Sites**
2. Open the site you want
3. Scroll to the **OIDC / SSO** section
4. Toggle:
   - **Enable OIDC for this site**
5. Choose the provider you created
6. (Optional) Set **Allowed email domains**
   - Example:
   ```text
   example.com, school.edu
   ```

7. Click **Save OIDC settings**

---

## 7) Test the guest flow

1. Connect a test device to the Hotspot SSID
2. Let it redirect to the portal
3. Choose **SSO / OIDC**
4. Complete the Microsoft login
5. Confirm the portal shows success and the device gets internet access

---

## 8) Troubleshooting

### “Redirect URI mismatch” (Microsoft error page)
- The redirect URI in Entra must match **exactly** (scheme, host, path)
- Double-check tenant slug + site slug in the URL

### Guests can’t complete SSO in captive browser
Captive portal browsers can be limited. Use the portal’s **Open in browser** fallback link.

### “Domain not allowed”
- Confirm you set `Allowed email domains` correctly
- Confirm the token includes an `email` claim (Token configuration step)

### SSO succeeds but guest doesn’t get access
That’s UniFi authorization, not OIDC:
- check the site’s UniFi base URL / API key / site id
- check API logs for errors
