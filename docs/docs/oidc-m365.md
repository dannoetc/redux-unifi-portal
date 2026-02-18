# OIDC SSO (Microsoft Entra ID)

Use this guide to enable Microsoft SSO for a tenant/site.

## Before you start

You need:
- portal base URL (`https://wifi.example.com`)
- tenant slug and site slug from admin UI
- access to Entra ID app registrations

## Step 1: Create Entra app registration

1. Entra ID -> `App registrations` -> `New registration`.
2. Use single-tenant unless you need otherwise.
3. Copy:
   - Application (client) ID
   - Directory (tenant) ID

## Step 2: Add redirect URI

In the app registration, add web redirect URI:

```text
https://wifi.example.com/api/oidc/callback/<tenant-slug>/<site-slug>
```

Add one URI per site using OIDC.

## Step 3: Create client secret

1. `Certificates & secrets` -> `New client secret`.
2. Copy the secret value immediately.

## Step 4: Ensure email claim exists

1. `Token configuration` -> `Add optional claim`.
2. Add `email` to ID token.

## Step 5: Create provider in ReduxTC

1. Open `Admin -> OIDC`.
2. Click `Add provider`.
3. Set:
   - issuer: `https://login.microsoftonline.com/<tenant-id>/v2.0`
   - client ID
   - client secret
   - scopes: `openid profile email`
4. Save.

## Step 6: Enable OIDC on site

1. Open `Admin -> Sites` and open site settings.
2. Go to `SSO` section.
3. Enable OIDC for site.
4. Select provider.
5. Optional: set allowed domains (`example.com, school.edu`).
6. Save changes.

## Test flow

1. Join SSID on test device.
2. Select SSO in guest portal.
3. Complete Microsoft login.
4. Confirm authorization and internet access.

## Common failures

- Redirect URI mismatch: callback URL does not exactly match Entra config.
- Domain not allowed: allowed-domain list or missing `email` claim.
- SSO succeeds but no internet: UniFi connection mapping issue, not OIDC.
