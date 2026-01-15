from __future__ import annotations

import uuid

from sqlalchemy import select

from app.models import PortalSession, Site, Tenant, TenantStatus
from app.services.portal_session import create_or_reuse_session


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value


def test_portal_session_reuse(db_session):
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
    db_session.add_all([tenant, site])
    db_session.commit()

    redis_client = FakeRedis()

    first = create_or_reuse_session(
        db_session,
        redis_client,
        tenant_id=tenant.id,
        site=site,
        client_mac="aa:bb:cc:dd:ee:ff",
        ap_mac="11:22:33:44:55:66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        ip="127.0.0.1",
        user_agent="pytest",
    )

    second = create_or_reuse_session(
        db_session,
        redis_client,
        tenant_id=tenant.id,
        site=site,
        client_mac="AA-BB-CC-DD-EE-FF",
        ap_mac="11-22-33-44-55-66",
        ssid="TestWiFi",
        orig_url="https://example.com",
        ip="127.0.0.1",
        user_agent="pytest",
    )

    assert first.portal_session_id == second.portal_session_id
    count = db_session.execute(select(PortalSession)).scalars().all()
    assert len(count) == 1
