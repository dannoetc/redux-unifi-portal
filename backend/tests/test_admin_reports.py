from __future__ import annotations

import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

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
    Voucher,
    VoucherBatch,
    VoucherRedemption,
)
from app.security import create_session_token, hash_password


def _login_as(client, admin: AdminUser) -> None:
    token = create_session_token(admin.id)
    client.cookies.set("admin_session", token)


def _seed_reporting_fixture(db_session):
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
    other_tenant = Tenant(id=uuid.uuid4(), slug="other", name="Other", status=TenantStatus.ACTIVE)
    other_site = Site(
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

    events = [
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_hq.id,
            method=AuthMethod.VOUCHER,
            result=AuthResult.SUCCESS,
            created_at=now,
        ),
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_hq.id,
            method=AuthMethod.VOUCHER,
            result=AuthResult.FAIL,
            created_at=now,
        ),
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_lobby.id,
            method=AuthMethod.TOS_ONLY,
            result=AuthResult.SUCCESS,
            created_at=now - timedelta(days=1),
        ),
        AuthEvent(
            id=uuid.uuid4(),
            tenant_id=tenant.id,
            site_id=site_lobby.id,
            method=AuthMethod.OIDC,
            result=AuthResult.SUCCESS,
            created_at=now,
        ),
    ]

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
        code="PROMO001",
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
        portal_session_id=None,
        client_mac="AA:BB:CC:DD:EE:FF",
        redeemed_at=now,
    )
    db_session.add_all(
        [
            tenant,
            site_hq,
            site_lobby,
            other_tenant,
            other_site,
            admin,
            membership,
            *events,
            batch,
            voucher,
            redemption,
        ]
    )
    db_session.commit()
    return {
        "tenant": tenant,
        "site_hq": site_hq,
        "site_lobby": site_lobby,
        "other_site": other_site,
        "admin": admin,
        "now": now,
    }


def test_method_daily_report_and_export(client, db_session):
    fixture = _seed_reporting_fixture(db_session)
    tenant = fixture["tenant"]
    site_lobby = fixture["site_lobby"]
    now = fixture["now"]

    _login_as(client, fixture["admin"])
    response = client.get(f"/api/admin/tenants/{tenant.id}/reports/method-daily?days=7")
    assert response.status_code == 200
    payload = response.json()["data"]
    assert payload["period_days"] == 7
    assert len(payload["rows"]) == 28  # 7 days * 4 auth methods

    today = now.date().isoformat()
    today_voucher = next(
        row for row in payload["rows"] if row["day"] == today and row["method"] == "voucher"
    )
    assert today_voucher["attempts"] == 2
    assert today_voucher["success"] == 1
    assert today_voucher["fail"] == 1

    filtered = client.get(
        f"/api/admin/tenants/{tenant.id}/reports/method-daily?days=7&site_id={site_lobby.id}&method=tos_only"
    )
    assert filtered.status_code == 200
    filtered_rows = filtered.json()["data"]["rows"]
    assert len(filtered_rows) == 7
    assert all(row["method"] == "tos_only" for row in filtered_rows)
    assert any(row["attempts"] == 1 and row["success"] == 1 for row in filtered_rows)

    csv_response = client.get(
        f"/api/admin/tenants/{tenant.id}/reports/method-daily/export.csv?days=7&site_id={site_lobby.id}&method=tos_only"
    )
    assert csv_response.status_code == 200
    parsed = list(csv.reader(io.StringIO(csv_response.text)))
    assert parsed[0] == ["day", "method", "attempts", "success", "fail", "success_rate"]
    assert any(row[1] == "tos_only" and row[2] == "1" and row[3] == "1" for row in parsed[1:])


def test_site_comparison_report_and_export(client, db_session):
    fixture = _seed_reporting_fixture(db_session)
    tenant = fixture["tenant"]
    site_hq = fixture["site_hq"]
    site_lobby = fixture["site_lobby"]

    _login_as(client, fixture["admin"])
    response = client.get(f"/api/admin/tenants/{tenant.id}/reports/site-comparison?days=7")
    assert response.status_code == 200
    rows = response.json()["data"]["rows"]
    by_site = {row["site_id"]: row for row in rows}

    assert by_site[str(site_hq.id)]["auth_attempts"] == 2
    assert by_site[str(site_hq.id)]["auth_success"] == 1
    assert by_site[str(site_hq.id)]["auth_fail"] == 1
    assert by_site[str(site_hq.id)]["voucher_redemptions"] == 1

    assert by_site[str(site_lobby.id)]["auth_attempts"] == 2
    assert by_site[str(site_lobby.id)]["auth_success"] == 2
    assert by_site[str(site_lobby.id)]["tos_clicks"] == 1

    csv_response = client.get(
        f"/api/admin/tenants/{tenant.id}/reports/site-comparison/export.csv?days=7&method=voucher"
    )
    assert csv_response.status_code == 200
    parsed = list(csv.reader(io.StringIO(csv_response.text)))
    assert parsed[0] == [
        "site_id",
        "site_name",
        "auth_attempts",
        "auth_success",
        "auth_fail",
        "success_rate",
        "voucher_redemptions",
        "tos_clicks",
    ]
    assert any(row[0] == str(site_hq.id) and row[2] == "2" for row in parsed[1:])
    assert any(row[0] == str(site_lobby.id) and row[2] == "0" for row in parsed[1:])


def test_reports_reject_cross_tenant_site_filter(client, db_session):
    fixture = _seed_reporting_fixture(db_session)
    tenant = fixture["tenant"]
    other_site = fixture["other_site"]

    _login_as(client, fixture["admin"])
    response = client.get(
        f"/api/admin/tenants/{tenant.id}/reports/site-comparison?days=7&site_id={other_site.id}"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"
