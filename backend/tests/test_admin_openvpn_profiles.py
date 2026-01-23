from __future__ import annotations

import uuid

from cryptography.fernet import Fernet

from app.models import AdminMembership, AdminRole, AdminUser, Tenant, TenantOpenvpnClientProfile, TenantStatus
from app.security import create_session_token, hash_password
from app.services.openvpn import decrypt_openvpn_secret, encrypt_openvpn_secret
from app.models.openvpn_secret import TenantOpenvpnSecret
from app.settings import settings


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def test_generate_openvpn_profile_requires_tenant(client, db_session):
    admin = AdminUser(
        id=uuid.uuid4(),
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(admin)
    db_session.commit()

    _login_as(client, admin)
    response = client.post("/api/admin/tenants/00000000-0000-0000-0000-000000000000/openvpn/generate", json={"client_name": "gw-1"})
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


def test_generate_openvpn_profile_requires_config(client, db_session):
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE, openvpn_enabled=False)
    admin = AdminUser(
        id=uuid.uuid4(),
        email="tenant.admin@example.com",
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
    response = client.post(f"/api/admin/tenants/{tenant.id}/openvpn/generate", json={"client_name": "gw-1"})
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "OPENVPN_NOT_CONFIGURED"


def test_download_openvpn_profile_returns_latest(client, db_session):
    settings.OPENVPN_ENCRYPTION_KEY = Fernet.generate_key().decode("utf-8")
    tenant = Tenant(id=uuid.uuid4(), slug="acme", name="Acme", status=TenantStatus.ACTIVE, openvpn_enabled=True)
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
    profile = TenantOpenvpnClientProfile(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        client_name="gateway-01",
        profile_encrypted=encrypt_openvpn_secret("client\nremote 1.2.3.4 1194\n"),
    )
    db_session.add_all([tenant, admin, membership, profile])
    db_session.commit()

    _login_as(client, admin)
    response = client.get(f"/api/admin/tenants/{tenant.id}/openvpn/profile")
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/x-openvpn-profile"
    assert "gateway-01.ovpn" in response.headers["content-disposition"]
    assert "remote 1.2.3.4 1194" in response.text


def test_generate_openvpn_profile_returns_credentials(client, db_session, monkeypatch):
    settings.OPENVPN_ENCRYPTION_KEY = Fernet.generate_key().decode("utf-8")
    tenant = Tenant(
        id=uuid.uuid4(),
        slug="acme",
        name="Acme",
        status=TenantStatus.ACTIVE,
        openvpn_enabled=False,
        openvpn_remote_host="vpn.reduxtc.com",
        openvpn_remote_port=1194,
    )
    admin = AdminUser(
        id=uuid.uuid4(),
        email="tenant.admin@example.com",
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

    monkeypatch.setattr(
        "app.routes.admin.generate_openvpn_client_profile",
        lambda _client_name: "client\nremote 1.2.3.4 1194\n",
    )

    _login_as(client, admin)
    response = client.post(f"/api/admin/tenants/{tenant.id}/openvpn/generate", json={"client_name": "gw-1"})
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["client"]["client_name"] == "gw-1"
    assert payload["auth_username"]
    assert payload["auth_password"]

    secret = db_session.query(TenantOpenvpnSecret).filter_by(tenant_id=tenant.id).one()
    decrypted = decrypt_openvpn_secret(secret.auth_blob_encrypted)
    assert payload["auth_username"] in decrypted
    assert payload["auth_password"] in decrypted
