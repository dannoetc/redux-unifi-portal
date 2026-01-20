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
    db_session.add_all([tenant, site, admin, membership, event])
    db_session.commit()

    _login_as(client, admin)
    response = client.get(f"/api/admin/tenants/{tenant.id}/auth-events")
    assert response.status_code == 200
    data = response.json()["data"]["events"]
    assert len(data) == 1
    assert data[0]["method"] == "voucher"
    assert data[0]["result"] == "success"

    filtered = client.get(f"/api/admin/tenants/{tenant.id}/auth-events?method=oidc")
    assert filtered.status_code == 200
    assert filtered.json()["data"]["events"] == []
