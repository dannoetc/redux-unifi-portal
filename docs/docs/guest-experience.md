# Guest Experience

Guests are redirected here after joining a UniFi Hotspot SSID.

## End-user flow

1. Guest joins WiFi.
2. UniFi redirects to `https://<your-domain>/guest/`.
3. Portal resolves tenant and site from redirect metadata.
4. Guest completes one auth method.
5. ReduxTC authorizes the device through UniFi.
6. Guest is shown `Continue` to return to browsing.

![Guest portal preview](assets/screenshots/guest-site-preview.png)

## Available auth methods

- `Voucher`: guest enters a staff-issued code
- `Email OTP`: guest enters email, receives code, and verifies
- `SSO (OIDC)`: guest signs in with configured IdP
- `TOS only`: guest accepts terms only

## Captive browser support

The portal includes an `Open in browser` fallback for SSO flows that fail in captive mini-browsers.

## Reconnect behavior

Portal sessions are reused when possible so guests do not have to restart every reconnect.
