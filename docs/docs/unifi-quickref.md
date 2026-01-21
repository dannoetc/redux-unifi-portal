# UniFi Quick Reference (cheat sheet)

This is the quick “what exactly are we calling?” page.

Use it when you’re debugging site resolution or authorization, or when you want to sanity-check a UniFi controller.

> Note: some hosted UniFi deployments require tenant-mode paths. If your controller config has a `tenant_id`,
> prepend `/v1/tenants/{tenantId}` before the `sites/...` part.

---

## 1) Find a client by MAC

We look up the connected guest client using the client MAC (UniFi usually sends it as `id=` in the redirect).

**Request**
- `GET /v1/sites/{siteId}/clients?filter=macAddress.eq('AA:BB:CC:DD:EE:FF')`

**Tenant-mode**
- `GET /v1/tenants/{tenantId}/sites/{siteId}/clients?filter=macAddress.eq('AA:BB:CC:DD:EE:FF')`

**What we need from the response**
- a `clientId` (or equivalent unique id used by the API)
- the `siteId`
- the client MAC field

---

## 2) Find an AP/device by MAC (optional helper)

We *may* look up the AP MAC (UniFi sends it as `ap=`) mainly as a supporting signal for troubleshooting or association checks.

**Request**
- `GET /v1/sites/{siteId}/devices?filter=macAddress.eq('AA:BB:CC:DD:EE:FF')`

**Tenant-mode**
- `GET /v1/tenants/{tenantId}/sites/{siteId}/devices?filter=macAddress.eq('AA:BB:CC:DD:EE:FF')`

---

## 3) Authorize the guest

Once we know the correct site and the client’s UniFi-side identifier, we authorize:

**Request**
- `POST /v1/sites/{siteId}/clients/{clientId}/actions`

**Tenant-mode**
- `POST /v1/tenants/{tenantId}/sites/{siteId}/clients/{clientId}/actions`

**Body**
```json
{
  "action": "AUTHORIZE_GUEST_ACCESS",
  "parameters": {
    "minutes": 480
  }
}
```

(Your deployment may also send bandwidth caps or other policy knobs depending on site settings.)

---

## Redirect parameters UniFi sends

Most common:
- `id` = client MAC
- `ap` = AP MAC
- `t` = timestamp-ish
- `url` = original destination UniFi captured (can be encoded/weird)
- `ssid` = SSID name

If the URL is messy (e.g., `/guest%3F...`), that’s expected. See Operations & Security for how we handle it.
