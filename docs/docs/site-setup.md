# Site Setup Checklist

A site controls location-level behavior for guest access.

## What a site configures

- branding and support contact
- portal template mode (`off`, `embed`, `replace`)
- guest policy defaults (time/data/rate limits)
- UniFi site mapping and connection overrides
- OIDC enablement and domain allowlist

## Open the site settings page

1. Go to `Admin -> Sites`.
2. Click `Preview` for the site you want to configure.

![Sites list](assets/screenshots/admin-sites.png)

The site settings page uses a right-side section navigator:
- Overview
- Branding
- Template
- Policy
- UniFi
- SSO

![Site settings overview](assets/screenshots/admin-site-detail.png)

## Configure each section

### Overview

Confirm:
- external portal IP
- template mode
- UniFi site ID
- dirty-state/save status

### Branding

Set logo URL, primary color, and support contact.

![Site branding section](assets/screenshots/admin-site-detail-branding.png)

### Template

Set portal template mode and content:
- `off`: built-in portal only
- `embed`: custom layout with `{{portal}}` placeholder
- `replace`: fully custom HTML

![Site template section](assets/screenshots/admin-site-detail-template.png)

### Policy

Set default policy values applied at authorize time:
- time limit minutes
- data limit MB (optional)
- RX/TX rate caps (optional)

![Site policy section](assets/screenshots/admin-site-detail-policy.png)

### UniFi

Set site-level UniFi connection overrides only when needed.

If left empty, tenant-level UniFi settings are used.

![Site UniFi section](assets/screenshots/admin-site-detail-unifi.png)

### SSO

Enable OIDC for this site, select provider, and optionally set allowed domains.

![Site SSO section](assets/screenshots/admin-site-detail-sso.png)

## Save and verify

1. Click `Save changes`.
2. Use `Preview portal` to sanity-check the guest page.
3. Run a real guest flow on the SSID.
