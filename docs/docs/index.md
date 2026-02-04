# ReduxTC WiFi Portal Documentation

Hey 👋 — this is the human-friendly guide to running the ReduxTC UniFi Captive Portal.

If you’re here to *operate* the platform (add tenants, set up sites, issue vouchers, troubleshoot captive portal weirdness),
you’re in the right place. If you’re here to *develop* the platform, the deeper technical spec lives in `SPEC.md` in the repo.

## What this platform does

ReduxTC hosts an **external captive portal** for UniFi Hotspot networks.

Guests connect to WiFi, see a splash page, complete an auth flow, and then we tell UniFi: “yep, let them through.”

### Key capabilities

- **Multi-tenant**: tenants + sites (MSP-friendly).
- **Guest auth options**: voucher code, email OTP, OIDC SSO, or terms-only.
- **UniFi integration**: we authorize guests via the UniFi Network API.
- **Admin console**: manage tenants, sites, branding, policies, vouchers, and IdPs.
- **Audit trail**: auth events + exports.

## Two experiences

- **Guest portal** — what visitors see.
- **Admin console** — what staff use to configure and manage everything.

## One portal URL, many sites

UniFi can be configured to send everyone to a single external portal URL.
We use the redirect parameters UniFi sends to figure out *which tenant/site* that guest belongs to.  
(And yes — UniFi sometimes sends those parameters in… creative ways. We handle it.)

## Getting started (basic operation)

Use this checklist after the platform is running.

1) **Log in**
   - Visit `/admin/login` and sign in with your admin credentials.

2) **Create your first tenant**
   - Go to **Tenants** and create a tenant with a slug and name.

3) **Add your UniFi controller credentials**
   - From the tenant row, choose **Configure UniFi**.
   - Enter the UniFi controller host/port and API key, then save.

4) **Test the UniFi connection**
   - In the same dialog, click **Test UniFi connection** to confirm API access.

5) **Discover/import sites**
   - Go to **Sites** and use **Discover from UniFi** to import sites from the controller.
   - Provision the sites you want to manage in the portal.

6) **Customize the portal template**
   - Open a site and go to the **Portal Template** tab.
   - Enable the custom template and paste your HTML.
   - Include the `{{portal}}` token where the built-in portal UI should render; omit it to fully replace the UI.

## Documentation map

- [Cheat Sheet](cheat-sheet.md) — idiot-proof, step-by-step “get it running” guide.
- [Guest Experience](guest-experience.md) — what guests see and how the flows work.
- [Admin Console](admin-console.md) — how staff manage tenants, sites, auth methods, and reporting.
- [Integrations](integrations.md) — UniFi + identity providers + email delivery.
- [Operations & Security](operations-security.md) — what we store, how we isolate tenants, and how to keep things running.
- [UniFi Quick Reference](unifi-quickref.md) — a short “cheat sheet” for the exact UniFi calls we make (handy for debugging).
- [OpenVPN Removal Report](openvpn-removal-report.md) — details on the removed OpenVPN integration.
