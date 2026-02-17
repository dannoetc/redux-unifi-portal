from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from app.models import (
    AdminMembership,
    AdminRole,
    AdminUser,
    AuthEvent,
    AuthMethod,
    AuthResult,
    PortalSession,
    PortalSessionStatus,
    Site,
    Tenant,
    TenantStatus,
    Voucher,
    VoucherBatch,
    VoucherRedemption,
)
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def test_dashboard_summary_returns_usage_and_clickthrough(client, db_session):
    now = datetime.now(timezone.utc)
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    site_hq = Site(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        slug="hq",
        display_name="HQ",
        enabled=True,
        unifi_site_id="default",
        default_time_limit_minutes=60,
    )
    site_lobby = Site(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        slug="lobby",
        display_name="Lobby",
        enabled=True,
        unifi_site_id="lobby",
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
        role=AdminRole.TENANT_VIEWER,
    )
    session_success = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site_hq.id,
        client_mac="AA:BB:CC:DD:EE:01",
        status=PortalSessionStatus.AUTHORIZED,
        created_at=now - timedelta(days=1),
        updated_at=now - timedelta(days=1),
    )
    session_fail = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site_hq.id,
        client_mac="AA:BB:CC:DD:EE:02",
        status=PortalSessionStatus.FAILED,
        created_at=now,
        updated_at=now,
    )
    session_started = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site_lobby.id,
        client_mac="AA:BB:CC:DD:EE:03",
        status=PortalSessionStatus.STARTED,
        created_at=now,
        updated_at=now,
    )
    batch = VoucherBatch(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site_hq.id,
        name="Promo",
        max_uses_per_code=1,
        created_at=now,
        updated_at=now,
    )
    voucher = Voucher(
        id=uuid.uuid4(),
        batch_id=batch.id,
        code="ABC12345",
        uses=1,
        disabled=False,
        created_at=now,
        updated_at=now,
    )
    redemption = VoucherRedemption(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site_hq.id,
        voucher_id=voucher.id,
        portal_session_id=session_success.id,
        client_mac="AA:BB:CC:DD:EE:01",
        redeemed_at=now,
    )
    events = [
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_hq.id,
            portal_session_id=session_success.id,
            method=AuthMethod.VOUCHER,
            result=AuthResult.SUCCESS,
            created_at=now,
        ),
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_hq.id,
            portal_session_id=session_fail.id,
            method=AuthMethod.VOUCHER,
            result=AuthResult.FAIL,
            reason="INVALID",
            created_at=now,
        ),
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_lobby.id,
            portal_session_id=session_started.id,
            method=AuthMethod.TOS_ONLY,
            result=AuthResult.SUCCESS,
            created_at=now,
        ),
    ]
    db_session.add_all(
        [
            tenant,
            site_hq,
            site_lobby,
            admin,
            membership,
            session_success,
            session_fail,
            session_started,
            batch,
            voucher,
            redemption,
            *events,
        ]
    )
    db_session.commit()

    _login_as(client, admin)
    response = client.get(f"/api/admin/tenants/{tenant.id}/dashboard/summary?days=7")
    assert response.status_code == 200
    payload = response.json()["data"]

    overview = payload["overview"]
    assert overview["sessions_started"] == 3
    assert overview["sessions_authorized"] == 1
    assert overview["sessions_failed"] == 1
    assert overview["auth_attempts"] == 3
    assert overview["auth_success"] == 2
    assert overview["auth_fail"] == 1
    assert overview["voucher_redemptions"] == 1
    assert overview["tos_clicks"] == 1
    assert overview["success_rate"] == 66.67

    methods = {item["method"]: item for item in payload["methods"]}
    assert methods["voucher"]["attempts"] == 2
    assert methods["voucher"]["success"] == 1
    assert methods["voucher"]["fail"] == 1
    assert methods["tos_only"]["success"] == 1

    sites = {item["site_name"]: item for item in payload["sites"]}
    assert sites["HQ"]["voucher_redemptions"] == 1
    assert sites["Lobby"]["tos_clicks"] == 1

    assert len(payload["daily"]) == 7
    assert {item["display_name"] for item in payload["site_options"]} == {"HQ", "Lobby"}


def test_dashboard_summary_rejects_cross_tenant_site_filter(client, db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    other_tenant = Tenant(id=uuid.uuid4(), slug="other", name="Other", status=TenantStatus.ACTIVE)
    site = Site(
        id=uuid.uuid4(),
        tenant_id=other_tenant.id,
        slug="other-site",
        display_name="Other Site",
        enabled=True,
        unifi_site_id="other",
        default_time_limit_minutes=60,
    )
    admin = AdminUser(
        id=uuid.uuid4(),
        email="viewer@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=False,
    )
    membership = AdminMembership(
        id=uuid.uuid4(),
        admin_user_id=admin.id,
        tenant_id=tenant.id,
        role=AdminRole.TENANT_VIEWER,
    )
    db_session.add_all([tenant, other_tenant, site, admin, membership])
    db_session.commit()

    _login_as(client, admin)
    response = client.get(
        f"/api/admin/tenants/{tenant.id}/dashboard/summary?site_id={site.id}"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
