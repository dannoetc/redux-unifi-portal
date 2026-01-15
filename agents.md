# agents.md — ReduxTC UniFi Captive Portal (redux-unifi-portal)

This file defines **how coding agents (Codex, etc.) should work in this repo** so changes stay consistent over time.

**Always read `SPEC.md` first.** If something in this document conflicts with `SPEC.md`, `SPEC.md` wins.

---

## 0) Repo structure

This is a **two-package monorepo**:

- `backend/` — FastAPI (API-only)
  - Postgres for durable state
  - Redis for sessions, OTP, rate limiting
  - Celery for async jobs (OTP email, future webhooks/reports)
  - UniFi **official Network API** integration (External Hotspot flow)

- `frontend/` — Next.js App Router (React/TypeScript)
  - Tailwind CSS
  - **shadcn/ui** (Radix primitives)
  - lucide-react icons
  - TanStack Table for admin grids
  - react-hook-form + zod for forms

Primary product spec: **`SPEC.md`**.

---

## 1) Non-negotiables

### MSP-first, always
- Tenants → Sites is the fundamental model.
- Every record is tenant-scoped either:
  - directly via `tenant_id`, or
  - indirectly via `site_id` (which implies `tenant_id`).
- Admin routes must enforce membership checks unless `is_superadmin=true`.
- Never infer a site from SSID/AP MAC. Resolve Site via path slugs:
  - Guest UI: `/guest/s/{tenant_slug}/{site_slug}/`
  - Guest API: `/api/guest/{tenant_slug}/{site_slug}/...`

### Backend is API-only
- **No server-rendered HTML** (no Jinja templates).
- Backend returns JSON (and CSV for exports).
- Frontend is the UI: both guest and admin.

### Secrets
- Prefer `*_ref` columns for UniFi API keys and OIDC secrets.
- Do **not** log secrets.
- In dev, secrets may be injected via env; in prod, secrets should come from a secret manager.

### Idempotency & reliability
- Captive portal flows often trigger duplicate requests.
- Redis is the source of truth for “active” portal sessions; DB is audit/history.
- Reuse existing portal session if Redis indicates one exists for (site_id, client_mac).
- UniFi client lookup can race association; implement retries with backoff.

### Minimal PII
- Store only what’s needed:
  - MAC addresses are required, but avoid displaying full MAC everywhere in admin UI.
  - Email only when OTP/SSO used.
  - Truncate/sanitize `orig_url`.

---

## 2) Backend conventions

### 2.1 Layout
- `app/routes/` — routers only (thin controllers)
- `app/services/` — business logic (UniFi, OTP, vouchers, OIDC, rate limiting, portal sessions)
- `app/models/` — SQLAlchemy ORM models
- `alembic/` — migrations

### 2.2 API envelope & error format
Prefer consistent responses:

- Success:
  ```json
  { "ok": true, "data": { ... } }
  ```
- Error:
  ```json
  { "ok": false, "error": { "code": "SOME_CODE", "message": "Human readable." } }
  ```

Use proper HTTP statuses:
- `400` validation
- `401` unauthenticated
- `403` unauthorized / tenant boundary
- `404` missing
- `409` conflict (voucher exhausted, etc.)
- `429` rate limited
- `5xx` unexpected failures

### 2.3 Validation & normalization
- Use Pydantic request/response models.
- Normalize MAC addresses to uppercase colon-separated format at ingress.
- Validate tenant/site slugs and ensure the site is enabled.

### 2.4 Tenant enforcement pattern
Implement dependencies (examples):
- `get_current_admin()`
- `require_superadmin()`
- `require_tenant_role(tenant_id, allowed_roles=[...])`

All admin endpoints must:
- determine tenant scope explicitly
- check membership unless superadmin

### 2.5 Logging & observability
- Use `structlog` with request IDs.
- Always include in logs when available:
  - `tenant_id`, `site_id`, `portal_session_id`, `auth_method`, `result`
- For UniFi API calls, log:
  - endpoint name (not full URL if it leaks hostnames), latency, status code
- Do not log secrets or full tokens.

### 2.6 Redis key conventions
Standardize keys:
- Portal session: `ps:{site_id}:{client_mac}`
- OTP challenge: `otp:{site_id}:{client_mac}:{email_hash}`
- Rate limit: `rl:{scope}:{key}:{window}` (window format chosen by implementation)

TTL guidelines:
- Portal session: ~30 minutes
- OTP challenge: ~10 minutes
- Rate-limit windows: 1–15 minutes depending on endpoint

### 2.7 UniFi integration
- Use official Network API endpoints as described in `SPEC.md`.
- Implement:
  - lookup client by MAC
  - authorize guest access (`AUTHORIZE_GUEST_ACCESS`)
  - retries on “client not found yet”
- Fail safely and return guest-friendly errors while logging real details server-side.

---

## 3) Frontend conventions (UniFi-adjacent)

### 3.1 UI library (locked)
- Tailwind + shadcn/ui + Radix primitives
- lucide-react icons
- TanStack Table for admin grids
- react-hook-form + zod for forms

### 3.2 UX goals
- Admin console: left sidebar nav + top header, cards & tables, subtle borders/shadows.
- Guest pages: lightweight, fast, captive-browser friendly.
- Provide “Open in browser” fallback for SSO.

### 3.3 API client
- Centralize in `frontend/lib/api.ts`
- Respect `NEXT_PUBLIC_API_BASE_URL`
- Normalize API errors into a single shape that maps to toasts and inline messages.

### 3.4 Route groups
- `app/(guest)/guest/s/[tenant]/[site]/...` — guest captive portal
- `app/(admin)/admin/...` — admin console

---

## 4) Testing expectations

### Backend
- Unit tests for:
  - tenant/membership enforcement
  - voucher validation/redemption (transaction behavior)
  - OTP start/verify (attempt limit)
  - UniFi client mocked via HTTPX
- Integration tests can be added later, but core business logic should be tested.

### Frontend
- Basic smoke tests are fine early on.
- Prefer component-driven development and keep pages thin.

---

## 5) Handling spec changes

If you need to change behavior:
1) Update `SPEC.md` first (or at least note the change).
2) Update backend and frontend consistently.
3) Add/adjust tests.
4) Ensure no tenant boundary regressions.

---

## 6) Definition of done

A change is done when:
- It compiles/runs locally
- It follows MSP-first scoping
- It doesn’t introduce raw secret leaks
- It includes minimal tests for new backend behavior
- It matches the locked UI stack and conventions above
