# UniFi Setup 

This is the UniFi-side configuration so guests get redirected to the ReduxTC portal and can be authorized correctly.

---

## 0) You need these values first

- Your portal domain (example): `wifi.example.com`
- Your external portal URL:

```text
https://wifi.example.com/guest/
```

- Your UniFi **site id** (example: `default`)
- A UniFi **API key** with access to the site

---

## 1) Create / verify a Hotspot SSID

In UniFi Network:
1. Create an SSID (or edit an existing one)
2. Enable **Hotspot / Captive Portal** for that network

Exact menu names vary by UniFi version, but you’re looking for:
- Hotspot manager / Captive portal
- External portal server

---

## 2) Set the External Portal URL

Set:

```text
https://wifi.example.com/guest/
```

This should be a single URL that works for every tenant/site. The portal resolves the correct tenant/site automatically from the redirect parameters UniFi includes.

---

## 3) Create an API key

In UniFi Network:
1. Create an API key (or “integration” key) for the portal
2. Store it as:
   - a tenant-level UniFi API key (recommended), or
   - a site-level override

Where to set it in the portal UI:
- Admin → Tenants (default)
- Admin → Sites (override)

---

## 4) Set the UniFi site id in the portal

In the portal Admin UI:
1. Go to **Admin → Sites**
2. Open the site
3. Set **UniFi site id** (commonly `default`)

---

## 5) Validate redirect + authorization

Quick validation checklist:
- Guest hits the external portal URL after joining WiFi
- Portal shows the correct site branding
- After auth, guest receives access (UniFi authorize call succeeds)

If you get “client not found” errors, see:
- **[Operations & Security](operations-security.md)**
- **[UniFi Quick Reference](unifi-quickref.md)**
