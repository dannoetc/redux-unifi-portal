# Integrations

ReduxTC integrates with UniFi Network controllers and optional identity providers to deliver guest
WiFi authorization.

## UniFi Network API

ReduxTC uses the official UniFi Network API to:

- Look up connected clients by MAC address.
- Authorize guests with the `AUTHORIZE_GUEST_ACCESS` action.
- Apply policy defaults such as time limits and bandwidth caps.

The portal resolves the correct site based on the incoming client details so UniFi can use a single
external portal URL for all sites.

## Identity providers (OIDC)

OIDC providers enable single sign-on for guests and staff identities, depending on your deployment.
Supported workflows include:

- Standard OIDC redirect and callback flows.
- PKCE + state validation for secure sign-in.
- Optional domain allowlists per site.

## Email delivery

Email OTP relies on your configured SMTP provider. Ensure that sender domains are authorized and
that outbound email is allowed from the deployment environment.
