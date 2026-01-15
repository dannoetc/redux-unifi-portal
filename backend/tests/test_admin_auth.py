from __future__ import annotations

import uuid

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.db import get_db
from app.deps import get_current_admin, require_tenant_role
from app.models import AdminMembership, AdminRole, AdminUser, Tenant, TenantStatus
from app.security import hash_password, verify_password


def test_password_hashing():
    password = "correct-horse-battery-staple"
    hashed = hash_password(password)
    assert verify_password(password, hashed)
    assert not verify_password("wrong-password", hashed)


def test_login_sets_cookie(client, db_session):
    admin = AdminUser(
        id=uuid.uuid4(),
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(admin)
    db_session.commit()

    response = client.post("/api/admin/login", json={"email": admin.email, "password": "secret"})
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert "admin_session=" in response.headers.get("set-cookie", "")


def test_require_tenant_role_enforces_membership(db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    admin = AdminUser(
        id=uuid.uuid4(),
        email="viewer@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=False,
    )
    db_session.add_all([tenant, admin])
    db_session.commit()

    membership = AdminMembership(
        id=uuid.uuid4(),
        admin_user_id=admin.id,
        tenant_id=tenant.id,
        role=AdminRole.TENANT_VIEWER,
    )
    db_session.add(membership)
    db_session.commit()

    api = FastAPI()

    @api.get("/tenants/{tenant_id}/check")
    def check(_admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN]))):
        return {"ok": True}

    def override_get_current_admin():
        return admin

    api.dependency_overrides[get_current_admin] = override_get_current_admin

    def override_get_db():
        yield db_session

    api.dependency_overrides[get_db] = override_get_db

    with TestClient(api) as test_client:
        response = test_client.get(f"/tenants/{tenant.id}/check")
        assert response.status_code == 403

        membership.role = AdminRole.TENANT_ADMIN
        db_session.add(membership)
        db_session.commit()

        response = test_client.get(f"/tenants/{tenant.id}/check")
        assert response.status_code == 200
