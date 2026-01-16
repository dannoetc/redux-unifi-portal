from __future__ import annotations

import json
import uuid

import httpx
from sqlalchemy import select

from app.models import (
    AuthEvent,
    AuthMethod,
    AuthResult,
    GuestIdentity,
    OidcProvider,
    PortalSession,
    PortalSessionStatus,
    Site,
    SiteOidcSetting,
    Tenant,
    TenantStatus,
    Voucher,
    VoucherBatch,
)
from app.services.otp import start_challenge
from app.services.portal_session import create_or_reuse_session, set_status
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


def _seed_site(db_session, *, enable_tos_only: bool = False):
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
        default_data_limit_mb=None,
        default_rx_kbps=None,
        default_tx_kbps=None,
        enable_tos_only=enable_tos_only,
    )
    db_session.add_all([tenant, site])
    db_session.commit()
    return tenant, site


def _seed_portal_session(db_session, tenant: Tenant, site: Site) -> PortalSession:
    portal_session = PortalSession(
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
    return portal_session


def _unifi_factory(transport: httpx.MockTransport):
    http_client = httpx.Client(base_url="https://unifi.local", transport=transport)

    def _factory(base_url: str, api_key: str, site_id: str, **kwargs):
        return UnifiClient(base_url, api_key, site_id, http_client=http_client, **kwargs)

    return _factory


def test_guest_config_includes_oidc(client, db_session):
    tenant, site = _seed_site(db_session)
    provider = OidcProvider(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        issuer="https://issuer.example.com",
        client_id="client-id",
        client_secret_ref="secret-ref",
        scopes="openid email profile",
    )
    setting = SiteOidcSetting(
        id=uuid.uuid4(),
        site_id=site.id,
        provider_id=provider.id,
        enabled=True,
    )
    db_session.add_all([provider, setting])
    db_session.commit()

    response = client.get(f"/api/guest/{tenant.slug}/{site.slug}/config")
    assert response.status_code == 200
    methods = response.json()["data"]["methods"]
    assert "oidc" in methods
    assert "voucher" in methods
    assert "email_otp" in methods


def test_voucher_endpoint_authorizes_unifi_httpx(client, db_session, monkeypatch):
    tenant, site = _seed_site(db_session)
    portal_session = _seed_portal_session(db_session, tenant, site)
    batch = VoucherBatch(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        name="Promo",
        max_uses_per_code=1,
    )
    voucher = Voucher(id=uuid.uuid4(), batch_id=batch.id, code="ABC123", uses=0, disabled=False)
    db_session.add_all([batch, voucher])
    db_session.commit()

    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.path == "/v1/sites/default/clients"
            assert request.url.params.get("filter") == "macAddress.eq('AA:BB:CC:DD:EE:FF')"
            return httpx.Response(200, json={"data": [{"id": "client-1"}]})
        if request.method == "POST":
            assert request.url.path == "/v1/sites/default/clients/client-1/actions"
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["action"] == "AUTHORIZE_GUEST_ACCESS"
            assert payload["timeLimitMinutes"] == 60
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(500, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(_routes.guest, "UnifiClient", _unifi_factory(transport))

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/voucher",
        json={"portal_session_id": str(portal_session.id), "code": "abc123"},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    updated_voucher = db_session.execute(select(Voucher).where(Voucher.id == voucher.id)).scalar_one()
    assert updated_voucher.uses == 1

    updated_session = db_session.execute(select(PortalSession).where(PortalSession.id == portal_session.id)).scalar_one()
    assert updated_session.status == PortalSessionStatus.AUTHORIZED

    auth_event = db_session.execute(
        select(AuthEvent).where(
            AuthEvent.portal_session_id == portal_session.id,
            AuthEvent.method == AuthMethod.VOUCHER,
            AuthEvent.result == AuthResult.SUCCESS,
        )
    ).scalar_one_or_none()
    assert auth_event is not None


def test_otp_verify_authorizes_unifi_httpx(client, db_session, monkeypatch):
    tenant, site = _seed_site(db_session)
    portal_session = _seed_portal_session(db_session, tenant, site)

    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.path == "/v1/sites/default/clients"
            assert request.url.params.get("filter") == "macAddress.eq('AA:BB:CC:DD:EE:FF')"
            return httpx.Response(200, json={"data": [{"id": "client-2"}]})
        if request.method == "POST":
            assert request.url.path == "/v1/sites/default/clients/client-2/actions"
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["action"] == "AUTHORIZE_GUEST_ACCESS"
            assert payload["timeLimitMinutes"] == 60
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(500, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(_routes.guest, "UnifiClient", _unifi_factory(transport))

    code = start_challenge(
        redis_client,
        site_id=site.id,
        client_mac=portal_session.client_mac,
        email="test@example.com",
    )

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/otp/verify",
        json={"portal_session_id": str(portal_session.id), "email": "test@example.com", "code": code},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    identity = db_session.execute(
        select(GuestIdentity).where(
            GuestIdentity.tenant_id == tenant.id,
            GuestIdentity.email == "test@example.com",
        )
    ).scalar_one_or_none()
    assert identity is not None

    auth_event = db_session.execute(
        select(AuthEvent).where(
            AuthEvent.portal_session_id == portal_session.id,
            AuthEvent.method == AuthMethod.EMAIL_OTP,
            AuthEvent.result == AuthResult.SUCCESS,
        )
    ).scalar_one_or_none()
    assert auth_event is not None


def test_tos_only_disabled(client, db_session):
    tenant, site = _seed_site(db_session, enable_tos_only=False)
    portal_session = _seed_portal_session(db_session, tenant, site)

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/tos/accept",
        json={"portal_session_id": str(portal_session.id)},
    )
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "TOS_ONLY_DISABLED"


def test_tos_only_authorizes_unifi_httpx(client, db_session, monkeypatch):
    tenant, site = _seed_site(db_session, enable_tos_only=True)
    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)

    session_data = create_or_reuse_session(
        db_session,
        redis_client,
        tenant_id=tenant.id,
        site=site,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        ip="127.0.0.1",
        user_agent="pytest",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.method == "GET":
            assert request.url.path == "/v1/sites/default/clients"
            assert request.url.params.get("filter") == "macAddress.eq('AA:BB:CC:DD:EE:FF')"
            return httpx.Response(200, json={"data": [{"id": "client-3"}]})
        if request.method == "POST":
            assert request.url.path == "/v1/sites/default/clients/client-3/actions"
            payload = json.loads(request.content.decode("utf-8"))
            assert payload["action"] == "AUTHORIZE_GUEST_ACCESS"
            assert payload["timeLimitMinutes"] == 60
            return httpx.Response(200, json={"ok": True})
        return httpx.Response(500, json={"error": "unexpected"})

    transport = httpx.MockTransport(handler)
    monkeypatch.setattr(_routes.guest, "UnifiClient", _unifi_factory(transport))

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/tos/accept",
        json={"portal_session_id": str(session_data.portal_session_id)},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    auth_event = db_session.execute(
        select(AuthEvent).where(
            AuthEvent.portal_session_id == session_data.portal_session_id,
            AuthEvent.method == AuthMethod.TOS_ONLY,
            AuthEvent.result == AuthResult.SUCCESS,
        )
    ).scalar_one_or_none()
    assert auth_event is not None


def test_tos_only_idempotent_when_authorized(client, db_session, monkeypatch):
    tenant, site = _seed_site(db_session, enable_tos_only=True)
    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)

    session_data = create_or_reuse_session(
        db_session,
        redis_client,
        tenant_id=tenant.id,
        site=site,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        ip="127.0.0.1",
        user_agent="pytest",
    )
    set_status(
        db_session,
        redis_client,
        site_id=site.id,
        client_mac="AA:BB:CC:DD:EE:FF",
        status=PortalSessionStatus.AUTHORIZED,
    )

    monkeypatch.setattr(_routes.guest, "UnifiClient", lambda *args, **kwargs: None)

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/tos/accept",
        json={"portal_session_id": str(session_data.portal_session_id)},
    )
    assert response.status_code == 200
    assert response.json()["ok"] is True

    auth_event = db_session.execute(
        select(AuthEvent).where(
            AuthEvent.portal_session_id == session_data.portal_session_id,
            AuthEvent.method == AuthMethod.TOS_ONLY,
        )
    ).scalar_one_or_none()
    assert auth_event is None


def test_tos_only_rate_limit(client, db_session, monkeypatch):
    tenant, site = _seed_site(db_session, enable_tos_only=True)
    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)
    monkeypatch.setattr(_routes.guest.settings, "VOUCHER_RATE_LIMIT_PER_IP", 0)
    monkeypatch.setattr(_routes.guest.settings, "VOUCHER_RATE_LIMIT_PER_MAC", 0)

    session_data = create_or_reuse_session(
        db_session,
        redis_client,
        tenant_id=tenant.id,
        site=site,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        ip="127.0.0.1",
        user_agent="pytest",
    )

    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/tos/accept",
        json={"portal_session_id": str(session_data.portal_session_id)},
    )
    assert response.status_code == 429
