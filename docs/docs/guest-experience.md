# Guest Experience

Guests are redirected to the ReduxTC portal after connecting to a UniFi Hotspot SSID. The portal
presents the site’s branding, terms, and available authentication options.

## Entry flow

1. Guest joins the WiFi network.
2. UniFi redirects the guest to the ReduxTC portal.
3. The portal resolves the tenant and site automatically.
4. The guest selects an authentication method and completes it.
5. ReduxTC authorizes the guest on the UniFi controller and shows a success screen.

## Guest-friendly features

- **Captive portal readiness** with clear status steps for slow or walled-garden browsers.
- **Branding and terms** supplied by each site for a consistent experience.
- **Automatic return** to the original URL when UniFi provides a destination.

## Authentication options

### Voucher code

- Guests enter a voucher code provided by staff.
- Vouchers can be limited by usage count or expiration date.
- After validation, the guest is authorized immediately.

### Email one-time passcode (OTP)

- Guests enter an email address.
- A one-time passcode is delivered by email.
- After verification, the guest is authorized.

### Single sign-on (OIDC)

- Guests authenticate with a configured identity provider.
- The portal supports captive-browser safe messaging and an “Open in browser” fallback.
- After sign-in, ReduxTC authorizes the guest.

### Terms of service only

- Guests accept the site’s terms.
- Access is granted without collecting additional identity details.

## Troubleshooting tips for guests

- **Portal does not load**: disconnect and reconnect to the WiFi SSID.
- **Email code not received**: check spam folders or ask staff to verify the address.
- **SSO not opening**: use the “Open in browser” link if the captive browser is limited.

## Success and access

Once authorized, the guest is returned to their original destination (when available) or sees a
success screen that confirms they can continue browsing.
