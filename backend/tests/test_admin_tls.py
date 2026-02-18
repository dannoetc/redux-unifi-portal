from __future__ import annotations

import subprocess
import uuid
from pathlib import Path

from app.models import AdminUser
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def _generate_self_signed_pair(tmp_path: Path, name: str) -> tuple[str, str]:
    cert_path = tmp_path / f"{name}.crt"
    key_path = tmp_path / f"{name}.key"
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-nodes",
            "-newkey",
            "rsa:2048",
            "-days",
            "7",
            "-keyout",
            str(key_path),
            "-out",
            str(cert_path),
            "-subj",
            "/CN=wifi.example.com",
        ],
        check=True,
        capture_output=True,
    )
    return cert_path.read_text(encoding="utf-8"), key_path.read_text(encoding="utf-8")


def test_superadmin_can_upload_custom_tls_certificate(client, db_session, monkeypatch, tmp_path):
    from app import routes as _routes

    certs_dir = tmp_path / "letsencrypt"
    monkeypatch.setattr(_routes.admin.settings, "TLS_CERTS_DIR", str(certs_dir))
    monkeypatch.setattr(_routes.admin.settings, "TLS_CERT_SOURCE_FILE", ".cert-source")
    monkeypatch.setattr(_routes.admin.settings, "DOMAIN", "wifi.example.com")

    admin = AdminUser(
        id=uuid.uuid4(),
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(admin)
    db_session.commit()
    _login_as(client, admin)

    cert_pem, key_pem = _generate_self_signed_pair(tmp_path, "pair1")
    response = client.put(
        "/api/admin/system/tls/custom",
        json={"certificate_pem": cert_pem, "private_key_pem": key_pem},
    )
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mode"] == "custom"
    assert payload["certificate_present"] is True
    assert payload["domain"] == "wifi.example.com"
    assert payload["self_signed"] is True

    cert_path = certs_dir / "live" / "wifi.example.com" / "fullchain.pem"
    key_path = certs_dir / "live" / "wifi.example.com" / "privkey.pem"
    assert cert_path.exists()
    assert key_path.exists()


def test_custom_tls_rejects_mismatched_key(client, db_session, monkeypatch, tmp_path):
    from app import routes as _routes

    certs_dir = tmp_path / "letsencrypt"
    monkeypatch.setattr(_routes.admin.settings, "TLS_CERTS_DIR", str(certs_dir))
    monkeypatch.setattr(_routes.admin.settings, "TLS_CERT_SOURCE_FILE", ".cert-source")
    monkeypatch.setattr(_routes.admin.settings, "DOMAIN", "wifi.example.com")

    admin = AdminUser(
        id=uuid.uuid4(),
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(admin)
    db_session.commit()
    _login_as(client, admin)

    cert_pem, _ = _generate_self_signed_pair(tmp_path, "pair1")
    _, other_key_pem = _generate_self_signed_pair(tmp_path, "pair2")
    response = client.put(
        "/api/admin/system/tls/custom",
        json={"certificate_pem": cert_pem, "private_key_pem": other_key_pem},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "CERT_KEY_MISMATCH"


def test_superadmin_can_switch_tls_mode_to_letsencrypt(client, db_session, monkeypatch, tmp_path):
    from app import routes as _routes

    certs_dir = tmp_path / "letsencrypt"
    monkeypatch.setattr(_routes.admin.settings, "TLS_CERTS_DIR", str(certs_dir))
    monkeypatch.setattr(_routes.admin.settings, "TLS_CERT_SOURCE_FILE", ".cert-source")
    monkeypatch.setattr(_routes.admin.settings, "DOMAIN", "wifi.example.com")

    admin = AdminUser(
        id=uuid.uuid4(),
        email="admin@example.com",
        password_hash=hash_password("secret"),
        is_superadmin=True,
    )
    db_session.add(admin)
    db_session.commit()
    _login_as(client, admin)

    response = client.put("/api/admin/system/tls/mode", json={"mode": "letsencrypt"})
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["mode"] == "letsencrypt"

    source_file = certs_dir / ".cert-source"
    assert source_file.exists()
    assert source_file.read_text(encoding="utf-8").strip() == "letsencrypt"
