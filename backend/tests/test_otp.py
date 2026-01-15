from __future__ import annotations

import uuid

from fastapi.testclient import TestClient

from app.celery_app import celery_app
from app.db import get_db
from app.main import app
from app.models import PortalSession, PortalSessionStatus, Site, Tenant, TenantStatus
from app.services.otp import start_challenge, verify_code


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


def test_otp_start_verify():
    redis_client = FakeRedis()
    site_id = uuid.uuid4()
    code = start_challenge(redis_client, site_id=site_id, client_mac="aa:bb:cc:dd:ee:ff", email="test@example.com")
    ok, reason = verify_code(
        redis_client,
        site_id=site_id,
        client_mac="aa:bb:cc:dd:ee:ff",
        email="test@example.com",
        code=code,
    )
    assert ok is True
    assert reason is None


def test_otp_endpoints(monkeypatch, db_session):
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
    )
    portal_session = PortalSession(
        tenant_id=tenant.id,
        site_id=site.id,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        status=PortalSessionStatus.STARTED,
    )
    db_session.add_all([tenant, site, portal_session])
    db_session.commit()

    redis_client = FakeRedis()

    def override_get_db():
        yield db_session

    from app import routes as _routes

    monkeypatch.setattr(_routes.guest, "get_redis_client", lambda: redis_client)
    monkeypatch.setattr(_routes.guest, "_authorize_unifi", lambda *_args, **_kwargs: (True, None, "client-1"))
    monkeypatch.setattr(_routes.guest, "send_otp_email", type("Dummy", (), {"delay": lambda *args, **kwargs: None})())
    app.dependency_overrides[get_db] = override_get_db

    celery_app.conf.task_always_eager = True

    client = TestClient(app)
    response = client.post(
        f"/api/guest/{tenant.slug}/{site.slug}/otp/start",
        json={"portal_session_id": str(portal_session.id), "email": "test@example.com"},
    )
    assert response.status_code == 200

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
    app.dependency_overrides.pop(get_db, None)
