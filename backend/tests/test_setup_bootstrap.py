from __future__ import annotations

import uuid

from app.models import AdminMembership, AdminRole, AdminUser, Site, Tenant
from app.security import hash_password


def test_setup_status_reports_unbootstrapped_defaults(client, monkeypatch):
    from app import routes as _routes

    monkeypatch.setattr(_routes.setup.settings, "SETUP_DEFAULT_ADMIN_EMAIL", "ops@example.com")
    monkeypatch.setattr(_routes.setup.settings, "SETUP_DEFAULT_TENANT_NAME", "Acme MSP")
    monkeypatch.setattr(_routes.setup.settings, "SETUP_DEFAULT_TENANT_SLUG", "acme")

    response = client.get("/api/setup/status")
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["bootstrapped"] is False
    assert payload["has_superadmin"] is False
    assert payload["defaults"]["admin_email"] == "ops@example.com"
    assert payload["defaults"]["tenant_name"] == "Acme MSP"
    assert payload["defaults"]["tenant_slug"] == "acme"


def test_bootstrap_creates_superadmin_tenant_and_optional_site(client, db_session):
    response = client.post(
        "/api/setup/bootstrap",
        json={
            "admin_email": "admin@example.com",
            "admin_password": "change-me-123",
            "tenant_name": "Acme MSP",
            "tenant_slug": "acme",
            "create_initial_site": True,
            "site": {
                "site_slug": "lab",
                "site_display_name": "Lab",
                "unifi_site_id": "default",
                "unifi_base_url": "https://controller.local",
                "unifi_port": 443,
            },
        },
    )
    assert response.status_code == 200
    body = response.json()["data"]
    assert body["bootstrapped"] is True
    assert body["admin_user"]["is_superadmin"] is True
    assert "admin_session=" in response.headers.get("set-cookie", "")

    tenant = db_session.get(Tenant, uuid.UUID(body["tenant_id"]))
    assert tenant is not None
    assert tenant.slug == "acme"

    admin = db_session.get(AdminUser, uuid.UUID(body["admin_user"]["id"]))
    assert admin is not None
    assert admin.is_superadmin is True

    membership = db_session.query(AdminMembership).filter(AdminMembership.admin_user_id == admin.id).one_or_none()
    assert membership is not None
    assert membership.tenant_id == tenant.id
    assert membership.role == AdminRole.TENANT_ADMIN

    site = db_session.get(Site, uuid.UUID(body["site_id"]))
    assert site is not None
    assert site.tenant_id == tenant.id
    assert site.slug == "lab"


def test_bootstrap_rejects_when_superadmin_exists(client, db_session):
    existing = AdminUser(
        id=uuid.uuid4(),
        email="existing@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(existing)
    db_session.commit()

    response = client.post(
        "/api/setup/bootstrap",
        json={
            "admin_email": "admin@example.com",
            "admin_password": "change-me-123",
            "tenant_name": "Acme MSP",
            "tenant_slug": "acme",
            "create_initial_site": False,
        },
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "BOOTSTRAP_ALREADY_COMPLETED"

