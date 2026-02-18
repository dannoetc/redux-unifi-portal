# UniFi Setup

This is the UniFi-side checklist required for portal redirects and guest authorization.

## Required values

- portal domain, for example `wifi.example.com`
- external portal URL: `https://wifi.example.com/guest/`
- UniFi site id (often `default`)
- UniFi API key with site access

## Configure Hotspot redirect

1. In UniFi Network, open the SSID.
2. Enable Hotspot/Captive Portal.
3. Configure external portal URL:

```text
https://wifi.example.com/guest/
```

## Configure API key in ReduxTC

Set the UniFi API key either:
- at tenant level (`Admin -> Tenants`) for defaults
- at site level (`Admin -> Sites`) for overrides

## Set UniFi site id

1. Open `Admin -> Sites`.
2. Open site settings.
3. Set `UniFi site id`.
4. Save.

## Validate end to end

- guest gets redirected to portal
- site branding matches expected location
- guest authorization succeeds after auth flow

If authorization fails with client lookup issues, see:
- [Operations & Security](operations-security.md)
- [UniFi Quick Reference](unifi-quickref.md)
