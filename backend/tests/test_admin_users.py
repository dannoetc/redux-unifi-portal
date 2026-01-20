from __future__ import annotations

import uuid

from app.models import AdminMembership, AdminRole, AdminUser, Tenant, TenantStatus
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def test_tenant_admin_can_create_and_list_admins(client, db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
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
    db_session.add_all([tenant, admin, membership])
    db_session.commit()

    _login_as(client, admin)
    payload = {
        "email": "new.admin@example.com",
        "password": "test-password",
        "role": "TENANT_VIEWER",
    }
    response = client.post(f"/api/admin/tenants/{tenant.id}/admins", json=payload)
    assert response.status_code == 200
    admin_data = response.json()["data"]["admin"]
    assert admin_data["email"] == "new.admin@example.com"
    assert admin_data["role"] == "TENANT_VIEWER"

    list_response = client.get(f"/api/admin/tenants/{tenant.id}/admins")
    assert list_response.status_code == 200
    emails = {row["email"] for row in list_response.json()["data"]["admins"]}
    assert "new.admin@example.com" in emails
