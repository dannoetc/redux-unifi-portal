from __future__ import annotations

import uuid

from app.models import AdminMembership, AdminRole, AdminUser, PortalSession, PortalSessionStatus, Site, Tenant, TenantStatus
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def test_superadmin_can_delete_tenant(client, db_session):
    admin = AdminUser(
        id=uuid.uuid4(),
        email="superadmin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    db_session.add_all([admin, tenant])
    db_session.commit()

    _login_as(client, admin)
    response = client.delete(f"/api/admin/tenants/{tenant.id}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True

    remaining = db_session.get(Tenant, tenant.id)
    assert remaining is None


def test_superadmin_create_tenant_duplicate_slug_returns_conflict(client, db_session):
    admin = AdminUser(
        id=uuid.uuid4(),
        email="superadmin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    existing = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE)
    db_session.add_all([admin, existing])
    db_session.commit()

    _login_as(client, admin)
    response = client.post(
        "/api/admin/tenants",
        json={"slug": "acme", "name": "Acme Two", "status": "ACTIVE"},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "SLUG_TAKEN"


def test_superadmin_can_delete_tenant_with_portal_sessions(client, db_session):
    admin = AdminUser(
        id=uuid.uuid4(),
        email="superadmin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
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
    session = PortalSession(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        site_id=site.id,
        client_mac="AA:BB:CC:DD:EE:FF",
        ap_mac="11:22:33:44:55:66",
        ssid="Guest",
        orig_url="http://example.com",
        status=PortalSessionStatus.STARTED,
    )
    db_session.add_all([admin, tenant, site, session])
    db_session.commit()

    _login_as(client, admin)
    response = client.delete(f"/api/admin/tenants/{tenant.id}")
    assert response.status_code == 200
    assert response.json()["data"]["deleted"] is True


def test_tenant_admin_can_create_and_delete_site(client, db_session):
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
        "display_name": "HQ",
        "slug": "hq",
        "enabled": True,
        "unifi_base_url": "https://unifi.local",
        "unifi_site_id": "default",
        "unifi_api_key_ref": "unifi-key",
        "default_time_limit_minutes": 30,
        "default_data_limit_mb": 500,
        "default_rx_kbps": 1000,
        "default_tx_kbps": 1000,
    }
    response = client.post(f"/api/admin/tenants/{tenant.id}/sites", json=payload)
    assert response.status_code == 200
    site_id = response.json()["data"]["site"]["id"]

    delete_response = client.delete(f"/api/admin/tenants/{tenant.id}/sites/{site_id}")
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["deleted"] is True


def test_tenant_admin_can_discover_unifi_sites(client, db_session, monkeypatch):
    tenant = Tenant(
        id=uuid.uuid4(),
        slug="acme",
        name="Acme",
        status=TenantStatus.ACTIVE,
        unifi_base_url="https://unifi.local/proxy/network/integration",
        unifi_api_key_ref="unifi-key",
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
    db_session.add_all([tenant, admin, membership])
    db_session.commit()

    def fake_list_sites(self):
        return [{"id": "site-1", "name": "Main Office", "internalReference": "default"}]

    monkeypatch.setattr("app.services.unifi.UnifiClient.list_sites", fake_list_sites)

    _login_as(client, admin)
    response = client.get(f"/api/admin/tenants/{tenant.id}/unifi/sites")
    assert response.status_code == 200
    data = response.json()["data"]["sites"]
    assert data[0]["id"] == "site-1"
    assert data[0]["suggested_slug"] == "main-office"


def test_tenant_admin_can_provision_sites_from_unifi(client, db_session, monkeypatch):
    tenant = Tenant(
        id=uuid.uuid4(),
        slug="acme",
        name="Acme",
        status=TenantStatus.ACTIVE,
        unifi_base_url="https://unifi.local/proxy/network/integration",
        unifi_api_key_ref="unifi-key",
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
    db_session.add_all([tenant, admin, membership])
    db_session.commit()

    def fake_list_sites(self):
        return [{"id": "site-1", "name": "Main Office"}]

    monkeypatch.setattr("app.services.unifi.UnifiClient.list_sites", fake_list_sites)

    _login_as(client, admin)
    response = client.post(
        f"/api/admin/tenants/{tenant.id}/sites/provision",
        json={"sites": [{"unifi_site_id": "site-1"}]},
    )
    assert response.status_code == 200
    sites = response.json()["data"]["sites"]
    assert sites[0]["unifi_site_id"] == "site-1"
    assert sites[0]["slug"] == "main-office"


def test_tenant_admin_can_update_portal_template(client, db_session):
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
    create_payload = {
        "display_name": "Lobby",
        "slug": "lobby",
        "enabled": True,
        "unifi_base_url": "https://unifi.local",
        "unifi_site_id": "default",
        "unifi_api_key_ref": "unifi-key",
        "default_time_limit_minutes": 30,
    }
    response = client.post(f"/api/admin/tenants/{tenant.id}/sites", json=create_payload)
    assert response.status_code == 200
    site_id = response.json()["data"]["site"]["id"]

    update_payload = {
        "portal_template_enabled": True,
        "portal_template_html": "<div>{{portal}}</div>",
    }
    update_response = client.put(f"/api/admin/tenants/{tenant.id}/sites/{site_id}", json=update_payload)
    assert update_response.status_code == 200
    site_data = update_response.json()["data"]["site"]
    assert site_data["portal_template_enabled"] is True
    assert site_data["portal_template_html"] == "<div>{{portal}}</div>"
