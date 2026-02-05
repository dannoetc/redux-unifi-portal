# Site Setup Checklist (idiot-proof)

This page is the “make the portal work for this location” checklist.

A **site** controls:
- branding (logo/colors)
- guest policy defaults (time, caps)
- UniFi target site id (where authorizations happen)
- which auth methods are available (TOS-only + OIDC enablement)

---

## 0) Start on the right site

1. Go to **Admin → Sites**
2. Click the site you’re configuring

---

## 1) Required: UniFi mapping

On the site page, you must set:

- **UniFi site id** (example: `default`)

And you must have UniFi connectivity configured either:
- at the **tenant** level (Admin → Tenants), or
- overridden on this **site** (fields on the site page)

If UniFi settings are missing, the portal cannot authorize guests.

---

## 2) Branding (optional but recommended)

Fill out:
- **Logo URL**
- **Primary color**
- **Support contact** (this gets shown in OTP emails and can be used in portal UI)

---

## 3) Terms and success behavior

- **Terms HTML**: the terms guests accept
- **Success URL** (optional): where to send guests after authorization

If you want “click-to-accept only” access, enable:

- **Enable TOS-only**

---

## 4) Portal template (advanced)

If you enable a custom portal template:
- Set **Portal template enabled**
- Paste **Portal template HTML**

The template should include the placeholder:

```text
{{portal}}
```

That’s where the built-in portal UI gets injected.

---

## 5) Guest policy defaults (recommended)

Set defaults so guests get a sane policy even when auth method doesn’t specify one:

- **Default time limit (minutes)**
- **Default data limit (MB)** (optional)
- **Default RX/TX (kbps)** (optional)

---

## 6) Enable auth methods

Out of the box, guests will see:
- Voucher
- Email OTP
- (Optional) TOS-only if enabled
- (Optional) OIDC if enabled

To make those work:

- Vouchers require generating voucher batches: **[Vouchers](vouchers.md)**
- Email OTP requires SMTP configured: **[Email OTP (SMTP)](email-otp-smtp.md)**
- OIDC requires an IdP provider + site settings: **[OIDC SSO (Microsoft Entra ID)](oidc-m365.md)**
