# ReduxTC WiFi Portal Documentation

Hey 👋 — this is the human-friendly guide to running the ReduxTC UniFi Captive Portal platform.

If you’re here to *operate* the platform (add tenants, set up sites, issue vouchers, troubleshoot captive portal weirdness),
you’re in the right place. If you’re here to *develop* the platform, the deeper technical spec lives in `SPEC.md` in the repo.

---

## Start here

1) Deploy the platform:
- **[Cheat Sheet (Production)](cheat-sheet.md)**
- **[Production Deployment (Ubuntu 20.04 / DigitalOcean)](deployment-ubuntu20-digitalocean.md)**

2) Configure your first customer:
- **[Tenant Onboarding](tenant-onboarding.md)**
- **[Site Setup Checklist](site-setup.md)**
- **[UniFi Setup](unifi-setup.md)**

3) Enable guest auth options:
- **[Vouchers](vouchers.md)**
- **[Email OTP (SMTP)](email-otp-smtp.md)**
- **[OIDC SSO (Microsoft Entra ID)](oidc-m365.md)**

4) Operate and report:
- **[Auth Events & Reporting](auth-events.md)**
- **[Troubleshooting](troubleshooting.md)**
- **[Operations & Security](operations-security.md)**

---

## What this platform does

ReduxTC hosts an **external captive portal** for UniFi Hotspot networks.

Guests connect to WiFi, see a splash page, complete an auth flow, and then we tell UniFi: “yep, let them through.”

### Key capabilities

- **Multi-tenant**: tenants + sites (MSP-friendly).
- **Guest auth options**: voucher code, email OTP, OIDC SSO, or terms-only.
- **UniFi integration**: we authorize guests via the UniFi Network API.
- **Admin console**: manage tenants, sites, branding, policies, vouchers, and IdPs.
- **Audit trail**: auth events + exports.

---

## Two experiences

- **Guest portal** — what visitors see.
- **Admin console** — what staff use to configure and manage everything.

## One portal URL, many sites

UniFi can be configured to send everyone to a single external portal URL:
`https://<your-domain>/guest/`

We use the redirect parameters UniFi provides to resolve the correct tenant/site and apply the right policy.
