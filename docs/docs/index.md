# ReduxTC WiFi Portal Documentation

Welcome to the ReduxTC UniFi Captive Portal platform. This guide is for end users and administrators who
configure and operate guest WiFi access for their sites.

## What the platform does

ReduxTC provides a hosted external captive portal for UniFi Hotspot networks. Guests connect to WiFi,
complete an authentication flow, and are authorized on the UniFi controller.

**Key capabilities**

- **Multi-tenant management** with tenants and sites, designed for MSP workflows.
- **Guest authentication methods**: voucher codes, email OTP, OIDC SSO, and terms-of-service only access.
- **UniFi Network API integration** to authorize guests after authentication.
- **Admin console** for managing sites, policies, voucher batches, and authentication providers.
- **Audit and exports** for auth events and voucher usage history.

## Who should use this guide

- **MSP operators** who manage multiple customer tenants and sites.
- **Tenant admins** who configure guest access methods and policies.
- **Front desk or hospitality staff** who issue vouchers and assist guests.

## Platform overview

ReduxTC has two main experiences:

- **Guest portal** — the WiFi splash page where visitors authenticate.
- **Admin console** — the operations center for managing tenants, sites, and policies.

The portal resolves the correct tenant and site automatically using the UniFi redirect parameters,
so one external portal URL can serve all sites.

## Documentation map

- [Guest Experience](guest-experience.md) — how visitors connect and authenticate.
- [Admin Console](admin-console.md) — how staff manage tenants, sites, and guest access policies.
- [Integrations](integrations.md) — how the portal connects to UniFi and identity providers.
- [Operations & Security](operations-security.md) — data handling, logging, and best practices.
