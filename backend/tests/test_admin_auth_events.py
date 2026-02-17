from __future__ import annotations

import uuid

from app.models import (
    AdminMembership,
    AdminRole,
    AdminUser,
    AuthEvent,
    AuthMethod,
    AuthResult,
    Site,
    Tenant,
    TenantStatus,
)
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def test_tenant_admin_can_list_auth_events(client, db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    site = Site(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        slug="hq",
        display_name="HQ",
        enabled=True,
        unifi_site_id="default",
        default_time_limit_minutes=60,
    )
    site_two = Site(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        slug="lobby",
        display_name="Lobby",
        enabled=True,
        unifi_site_id="lobby",
        default_time_limit_minutes=60,
    )
    other_tenant = Tenant(id=uuid.uuid4(), slug="other", name="Other", status=TenantStatus.ACTIVE)
    other_site = Site(
        id=uuid.uuid4(),
        tenant_id=other_tenant.id,
        slug="other-hq",
        display_name="Other HQ",
        enabled=True,
        unifi_site_id="other-default",
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
    event = AuthEvent(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        method=AuthMethod.VOUCHER,
        result=AuthResult.SUCCESS,
        reason="ok",
    )
    event_two = AuthEvent(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site_two.id,
        method=AuthMethod.EMAIL_OTP,
        result=AuthResult.FAIL,
        reason="otp invalid",
    )
    db_session.add_all([tenant, site, site_two, other_tenant, other_site, admin, membership, event, event_two])
    db_session.commit()

    _login_as(client, admin)
    response = client.get(f"/api/admin/tenants/{tenant.id}/auth-events")
    assert response.status_code == 200
    data = response.json()["data"]["events"]
    assert len(data) == 2
    assert any(item["method"] == "voucher" and item["result"] == "success" for item in data)
    assert any(item["method"] == "email_otp" and item["result"] == "fail" for item in data)

    filtered = client.get(f"/api/admin/tenants/{tenant.id}/auth-events?method=oidc")
    assert filtered.status_code == 200
    assert filtered.json()["data"]["events"] == []

    site_filtered = client.get(f"/api/admin/tenants/{tenant.id}/auth-events?site_id={site.id}")
    assert site_filtered.status_code == 200
    site_events = site_filtered.json()["data"]["events"]
    assert len(site_events) == 1
    assert site_events[0]["site_id"] == str(site.id)

    wrong_site = client.get(f"/api/admin/tenants/{tenant.id}/auth-events?site_id={other_site.id}")
    assert wrong_site.status_code == 404
    assert wrong_site.json()["error"]["code"] == "NOT_FOUND"
