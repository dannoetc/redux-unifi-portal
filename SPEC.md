# MSP-First Technical Specification — ReduxTC UniFi Captive Portal (SaaS)

Target prod domain: `wifi.reduxtc.com`

## 1) Objectives

### Primary objectives
- Hosted external captive portal for UniFi Hotspot networks:
  - Ingress: UniFi redirect to external portal with query params (AP MAC, client MAC, SSID, original URL, timestamp).
  - Guest auth methods: **OIDC SSO**, **Voucher**, **Email OTP**
  - Egress: authorize guests via UniFi **Network API** `AUTHORIZE_GUEST_ACCESS`.

- **MSP-first** from day one:
  - Tenants (customers) -> Sites
  - Tenant-scoped admin & data isolation

### Non-goals (v1)
- Payments, PMS/hotel integrations
- SMS OTP
- Legacy controller/private API support
- Deep analytics dashboards (CSV exports are OK)

---

## 2) UniFi Integration Contract (Official External Hotspot API)

UniFi external portal redirect includes query parameters such as:
- `ap` (AP MAC), `id` (client MAC), `t`, `url`, `ssid`.

Example path structure: `/guest/s/default/?ap=...&id=...&...`

### Authorization (server -> UniFi)
1. Find client by MAC:
   - `GET /v1/sites/{siteId}/clients` filtered by MAC
2. Authorize:
   - `POST /v1/sites/{siteId}/clients/{clientId}/actions`
   - body: `{ action: "AUTHORIZE_GUEST_ACCESS", ...policy }`
3. (Optional) Verify:
   - `GET /v1/sites/{siteId}/clients/{clientId}` returns `authorized: true`

### Site resolution (MSP-friendly, deterministic)
Configure each UniFi site's external portal URL as:

`https://wifi.reduxtc.com/guest/s/{tenant_slug}/{site_slug}/`

This removes the need to guess siteId from SSID/AP-MAC.

---

## 3) Architecture

### Monorepo layout
- `backend/` — FastAPI API + Postgres + Redis + Celery worker
- `frontend/` — Next.js App Router (React/TS) admin console + guest portal

### Backend stack
- FastAPI
- SQLAlchemy 2.0 + Alembic
- Postgres
- Redis (sessions + OTP + rate limiting)
- Celery (OTP email + async jobs)
- HTTPX (UniFi API calls)
- Authlib (OIDC client, token validation where needed)
- Structlog (JSON logging)

### Frontend stack (locked)
- Next.js (App Router) + React + TypeScript
- Tailwind CSS
- **shadcn/ui** (Radix UI primitives)
- lucide-react (icons)
- TanStack Table (admin grids)
- Zod + react-hook-form (forms + validation)
- Fetch layer: typed API client (OpenAPI or hand-rolled)

---

## 4) UI/UX Spec — UniFi-adjacent presentation

### Design goal
Feel like an “extension” of the UniFi console by matching interaction patterns:
- Left-side navigation + top header for admin
- Neutral palette, subtle borders/shadows, generous spacing
- Card + table-first information layout
- Consistent iconography and form control styles

### Theming & branding rules
- Base theme: UniFi-adjacent neutral UI (controlled by Tailwind tokens)
- Tenant branding overlays:
  - logo + brand color used for highlights and login/guest pages
  - avoid tenant overrides that break component geometry
- Typography: Inter (or system fallback)
- Radius: 10–12px for cards/dialogs, 8px for inputs
- Density: “comfortable” (not condensed)

### Route groups (Next.js)
- `/(guest)/guest/s/[tenant]/[site]/` … captive portal pages
- `/(admin)/admin/` … MSP admin console

---

## 5) Core Flows

### 5.1 Guest entry & session
`GET /guest/s/{tenant_slug}/{site_slug}/?ap=...&id=...&ssid=...&url=...&t=...`

Server actions:
- Validate slugs + MAC format
- Create/reuse portal session:
  - Redis key: `ps:{site_id}:{client_mac}`
  - Postgres row for audit
- Render guest landing UI with auth method options

### 5.2 Voucher auth
- Validate voucher (enabled, not expired, usage limits, site ownership)
- Record redemption transactionally
- Authorize via UniFi
- Log auth event
- Return success page with “Continue”

### 5.3 Email OTP
- Start:
  - rate-limit by IP + MAC
  - create OTP challenge in Redis (hash + TTL + attempt count)
  - enqueue email send
- Verify:
  - validate code, enforce attempt cap
  - upsert guest identity (email)
  - authorize via UniFi
  - log event

### 5.4 OIDC SSO
- Start:
  - redirect to provider using Authlib (PKCE + nonce + state stored in Redis)
- Callback:
  - validate state
  - exchange code, parse claims
  - upsert identity (email/sub/name)
  - authorize via UniFi
  - log event
- Captive-browser friendliness:
  - include “Open in browser” fallback CTA

---

## 6) UniFi Authorization Logic

### Inputs (per Site)
- `unifi_base_url`
- `unifi_site_id`
- `unifi_api_key` (stored as secret reference)
- Default policy fields:
  - `time_limit_minutes`
  - optional: `data_limit_mb`, `rx_kbps`, `tx_kbps`

### Behavior
- Lookup client by MAC with retries (race with association is common)
- Call authorize action
- Optionally verify authorized status

---

## 7) Data Model (MSP-first)

### Tenancy & admin
- `tenants` (id, slug, name, status, timestamps)
- `admin_users` (id, email, password_hash, is_superadmin)
- `admin_memberships` (admin_user_id, tenant_id, role)

### Sites
- `sites` (tenant_id, slug, display_name, enabled, unifi connection fields, branding, default policy)

### Guest & audit
- `portal_sessions` (tenant_id, site_id, client_mac, ap_mac, ssid, orig_url, status, ip, user_agent, timestamps)
- `guest_identities` (tenant_id, email?, oidc_sub?, display_name?)
- `auth_events` (tenant_id, site_id, method, result, reason?, portal_session_id, guest_identity_id?)

### Vouchers
- `voucher_batches` (tenant_id, site_id, name, expires_at?, max_uses_per_code)
- `vouchers` (batch_id, code, uses, disabled)
- `voucher_redemptions` (tenant_id, site_id, voucher_id, portal_session_id, client_mac, redeemed_at)

### OIDC config
- `oidc_providers` (tenant_id, issuer, client_id, client_secret_ref, scopes)
- `site_oidc_settings` (site_id, provider_id, enabled, allowed_domains?)

---

## 8) API Surface (backend)

### Public (guest) API
- `POST /api/guest/{tenant}/{site}/voucher`
- `POST /api/guest/{tenant}/{site}/otp/start`
- `POST /api/guest/{tenant}/{site}/otp/verify`
- `GET  /api/guest/{tenant}/{site}/config` (branding + enabled methods + policy defaults)
- `POST /api/guest/{tenant}/{site}/authorize` (internal use after auth)

### OIDC
- `GET  /api/oidc/{tenant}/{site}/start`
- `GET  /api/oidc/callback/{tenant}/{site}`

### Admin API
- `POST /api/admin/login`
- `GET  /api/admin/me`
- `CRUD /api/admin/tenants` (superadmin)
- `CRUD /api/admin/tenants/{tenant_id}/sites`
- `CRUD /api/admin/tenants/{tenant_id}/oidc-providers`
- `POST /api/admin/tenants/{tenant_id}/sites/{site_id}/vouchers/batches`
- `GET  /api/admin/tenants/{tenant_id}/sites/{site_id}/vouchers/batches/{batch_id}/export.csv`
- `GET  /api/admin/tenants/{tenant_id}/auth-events` (+ export)

---

## 9) Frontend Pages (Next.js)

### Guest
- Landing page (methods list, terms, branding)
- Voucher form
- Email OTP start + verify
- SSO button + “Open in browser” link
- Success page (“Continue”)

### Admin
- Login
- Tenant picker (superadmin)
- Tenant overview
- Sites list + site settings
- OIDC providers list + editor
- Vouchers: batches + export
- Auth events: table + filters + export

---

## 10) Security & Controls

- Tenant isolation enforced at API layer (membership checks) and in DB queries
- Rate limiting (Redis) for OTP and voucher attempts
- Idempotency:
  - reuse portal session if Redis key exists
  - if already authorized, return success
- Secrets:
  - API keys and OIDC secrets stored outside DB when possible (secret refs)
- TLS everywhere + HSTS in production
- Structured logs with request IDs; capture UniFi API call outcomes

---

## 11) Acceptance Criteria (v1)

- Supports tenants -> sites from day one.
- For each site:
  - Guest can complete voucher, email OTP, or OIDC SSO
  - Guest is authorized in UniFi via `AUTHORIZE_GUEST_ACCESS`
  - Auth event logged with tenant_id/site_id
- Admin can:
  - manage tenants (superadmin) and sites (tenant admin)
  - create voucher batches + export codes
  - configure OIDC provider and enable it per site
  - view/export auth events
