from __future__ import annotations

import uuid

from sqlalchemy import select

from app.main import app
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
)
from app.services.oidc import generate_state_token, store_oidc_state


class FakeRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    def get(self, key: str) -> str | None:
        return self.store.get(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value

    def delete(self, key: str) -> None:
        self.store.pop(key, None)


def _seed_oidc_site(db_session):
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
    provider = OidcProvider(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        issuer="https://issuer.example.com",
        client_id="client-id",
        client_secret_ref="OIDC_SECRET",
        scopes="openid email profile",
    )
    setting = SiteOidcSetting(
        id=uuid.uuid4(),
        site_id=site.id,
        provider_id=provider.id,
        enabled=True,
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
    db_session.add_all([tenant, site, provider, setting, portal_session])
    db_session.commit()
    return tenant, site, provider, setting, portal_session


def test_oidc_callback_success(client, db_session, monkeypatch):
    tenant, site, provider, _setting, portal_session = _seed_oidc_site(db_session)
    redis_client = FakeRedis()

    from app import routes as _routes

    monkeypatch.setattr(_routes.oidc, "get_redis_client", lambda: redis_client)
    monkeypatch.setattr(
        _routes.oidc,
        "exchange_code_for_claims",
        lambda **_kwargs: {"sub": "sub-1", "email": "user@example.com", "name": "User"},
    )
    monkeypatch.setattr(_routes.oidc, "_authorize_unifi", lambda *_args, **_kwargs: (True, None, "client-1"))

    state = generate_state_token(portal_session.id)
    store_oidc_state(
        redis_client,
        portal_session_id=portal_session.id,
        state=state,
        nonce="nonce",
        code_verifier="verifier",
        provider_id=provider.id,
    )

    response = client.get(
        f"/api/oidc/callback/{tenant.slug}/{site.slug}",
        params={"state": state, "code": "code"},
        allow_redirects=False,
    )
    assert response.status_code == 302
    assert "portal_session_id=" in response.headers.get("location", "")

    identity = db_session.execute(
        select(GuestIdentity).where(
            GuestIdentity.tenant_id == tenant.id,
            GuestIdentity.oidc_sub == "sub-1",
        )
    ).scalar_one_or_none()
    assert identity is not None

    updated_session = db_session.execute(
        select(PortalSession).where(PortalSession.id == portal_session.id)
    ).scalar_one()
    assert updated_session.status == PortalSessionStatus.AUTHORIZED

    auth_event = db_session.execute(
        select(AuthEvent).where(
            AuthEvent.portal_session_id == portal_session.id,
            AuthEvent.method == AuthMethod.OIDC,
            AuthEvent.result == AuthResult.SUCCESS,
        )
    ).scalar_one_or_none()
    assert auth_event is not None


def test_oidc_domain_allowlist_denies(client, db_session, monkeypatch):
    tenant, site, provider, setting, portal_session = _seed_oidc_site(db_session)
    setting.allowed_domains = "example.com"
    db_session.add(setting)
    db_session.commit()

    redis_client = FakeRedis()
    from app import routes as _routes

    monkeypatch.setattr(_routes.oidc, "get_redis_client", lambda: redis_client)
    monkeypatch.setattr(
        _routes.oidc,
        "exchange_code_for_claims",
        lambda **_kwargs: {"sub": "sub-2", "email": "user@other.com", "name": "User"},
    )

    state = generate_state_token(portal_session.id)
    store_oidc_state(
        redis_client,
        portal_session_id=portal_session.id,
        state=state,
        nonce="nonce",
        code_verifier="verifier",
        provider_id=provider.id,
    )

    response = client.get(
        f"/api/oidc/callback/{tenant.slug}/{site.slug}",
        params={"state": state, "code": "code"},
        allow_redirects=False,
    )
    assert response.status_code == 302
    assert "error=OIDC_DOMAIN_DENIED" in response.headers.get("location", "")

    auth_event = db_session.execute(
        select(AuthEvent).where(
            AuthEvent.portal_session_id == portal_session.id,
            AuthEvent.method == AuthMethod.OIDC,
            AuthEvent.result == AuthResult.FAIL,
        )
    ).scalar_one_or_none()
    assert auth_event is not None
