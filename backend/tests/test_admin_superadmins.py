from __future__ import annotations

import uuid

from app.models import AdminUser
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def test_superadmin_crud_flow(client, db_session):
    root = AdminUser(
        id=uuid.uuid4(),
        email="root@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(root)
    db_session.commit()

    _login_as(client, root)

    create_resp = client.post(
        "/api/admin/superadmins",
        json={"email": "ops@example.com", "password": "change-me-123"},
    )
    assert create_resp.status_code == 200
    created = create_resp.json()["data"]["superadmin"]
    created_id = created["id"]

    list_resp = client.get("/api/admin/superadmins")
    assert list_resp.status_code == 200
    emails = {entry["email"] for entry in list_resp.json()["data"]["superadmins"]}
    assert "root@example.com" in emails
    assert "ops@example.com" in emails

    update_resp = client.put(
        f"/api/admin/superadmins/{created_id}",
        json={"email": "ops.updated@example.com", "password": "new-password-123"},
    )
    assert update_resp.status_code == 200
    assert update_resp.json()["data"]["superadmin"]["email"] == "ops.updated@example.com"

    delete_resp = client.delete(f"/api/admin/superadmins/{created_id}")
    assert delete_resp.status_code == 200
    assert delete_resp.json()["data"]["deleted"] is True


def test_cannot_delete_last_superadmin(client, db_session):
    root = AdminUser(
        id=uuid.uuid4(),
        email="root@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(root)
    db_session.commit()

    _login_as(client, root)
    resp = client.delete(f"/api/admin/superadmins/{root.id}")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "SELF_DELETE_NOT_ALLOWED"


def test_superadmin_must_not_delete_self_even_if_multiple(client, db_session):
    first = AdminUser(
        id=uuid.uuid4(),
        email="first@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    second = AdminUser(
        id=uuid.uuid4(),
        email="second@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add_all([first, second])
    db_session.commit()

    _login_as(client, first)
    resp = client.delete(f"/api/admin/superadmins/{first.id}")
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "SELF_DELETE_NOT_ALLOWED"


def test_non_superadmin_cannot_manage_superadmins(client, db_session):
    regular = AdminUser(
        id=uuid.uuid4(),
        email="user@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=False,
    )
    db_session.add(regular)
    db_session.commit()

    _login_as(client, regular)
    resp = client.get("/api/admin/superadmins")
    assert resp.status_code == 403

