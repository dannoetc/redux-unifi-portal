from __future__ import annotations

import json
import uuid

import httpx
from sqlalchemy import select

from app.models import (
    AdminMembership,
    AdminRole,
    AdminUser,
    PortalSession,
    PortalSessionStatus,
    Site,
    Tenant,
    TenantStatus,
    Voucher,
    VoucherBatch,
)
from app.security import hash_password
from app.services.unifi import UnifiClient


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.counters: dict[str, int] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value

    def delete(self, key: str) -> None:
        self.store.pop(key, None)

    def incr(self, key: str) -> int:
        self.counters[key] = self.counters.get(key, 0) + 1
        return self.counters[key]

    def expire(self, key: str, ttl: int) -> None:
        return None


def _unifi_factory(transport: httpx.MockTransport):
    http_client = httpx.Client(base_url="https://unifi.local", transport=transport)

    def _factory(base_url: str, api_key: str, site_id: str, **kwargs):
        return UnifiClient(base_url, api_key, site_id, http_client=http_client, **kwargs)

    return _factory


def _seed_admin_tenant_site(db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    site = Site(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        slug="lab",
        display_name="Lab",
        enabled=True,
        unifi_base_url="https://unifi.local",
        unifi_site_id="default",
        unifi_api_key_ref="dev",
        default_time_limit_minutes=60,
    )
    admin = AdminUser(
        id=uuid.uuid4(),
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=False,
    )
    membership = AdminMembership(
        id=uuid.uuid4(),
        admin_user_id=admin.id,
        tenant_id=tenant.id,
        role=AdminRole.TENANT_ADMIN,
    )
    db_session.add_all([tenant, site, admin, membership])
    db_session.commit()
    return tenant, site


def test_generated_voucher_codes_can_be_redeemed(client, db_session, monkeypatch):
    tenant, site = _seed_admin_tenant_site(db_session)

    login = client.post("/api/admin/login", json={"email": "admin@example.com", "password": "secret"})
    assert login.status_code == 200

    create_batch = client.post(
        f"/api/admin/tenants/{tenant.id}/sites/{site.id}/vouchers/batches",
        json={"name": "Promo", "count": 5, "code_length": 8, "max_uses_per_code": 1},
    )
    assert create_batch.status_code == 200

    batch_id = uuid.UUID(create_batch.json()["data"]["batch_id"])
    vouchers = db_session.execute(select(Voucher).join(VoucherBatch).where(VoucherBatch.id == batch_id)).scalars().all()
    assert len(vouchers) == 5
    assert len({voucher.code for voucher in vouchers}) == 5
    assert all(len(voucher.code) == 8 for voucher in vouchers)

    portal_session = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        status=PortalSessionStatus.STARTED,
    )
    db_session.add(portal_session)
    db_session.commit()

    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            return httpx.Response(200, json={"data": [{"id": "client-1"}]})
        if request.method == "POST":
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["action"] == "AUTHORIZE_GUEST_ACCESS"
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(500, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(_routes.guest, "UnifiClient", _unifi_factory(transport))

    redeem = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/voucher",
        json={"portal_session_id": str(portal_session.id), "code": vouchers[0].code.lower()},
    )
    assert redeem.status_code == 200
    assert redeem.json()["ok"] is True


def test_unknown_voucher_code_returns_invalid_error(client, db_session, monkeypatch):
    tenant, site = _seed_admin_tenant_site(db_session)

    portal_session = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        status=PortalSessionStatus.STARTED,
    )
    db_session.add(portal_session)
    db_session.commit()

    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)
    monkeypatch.setattr(_routes.guest, "_authorize_unifi", lambda *args, **kwargs: (True, None, "client-1"))

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/voucher",
        json={"portal_session_id": str(portal_session.id), "code": "DOESNOTEXIST"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VOUCHER_INVALID"
