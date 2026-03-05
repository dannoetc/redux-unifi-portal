from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import ADMIN_SESSION_COOKIE
from app.models import AdminMembership, AdminRole, AdminUser, Site, Tenant, TenantStatus
from app.redis import get_redis_client
from app.schemas.setup import SetupBootstrapRequest, SetupDefaultsResponse, SetupStatusResponse
from app.security import create_session_token, hash_password
from app.services.ratelimit import enforce_rate_limit, limit_key_ip
from app.services.secrets import SecretError, encrypt_secret
from app.settings import settings

router = APIRouter()


def _has_superadmin(db: Session) -> bool:
    count = (
        db.execute(select(func.count()).select_from(AdminUser).where(AdminUser.is_superadmin.is_(True))).scalar_one()
    )
    return bool(count)


def _normalize_secret(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    if trimmed == "":
        return None
    return trimmed


def _default_setup_values() -> SetupDefaultsResponse:
    return SetupDefaultsResponse(
        admin_email=settings.SETUP_DEFAULT_ADMIN_EMAIL,
        tenant_name=settings.SETUP_DEFAULT_TENANT_NAME,
        tenant_slug=settings.SETUP_DEFAULT_TENANT_SLUG,
        site_slug=settings.SETUP_DEFAULT_SITE_SLUG,
        site_display_name=settings.SETUP_DEFAULT_SITE_DISPLAY_NAME,
        unifi_base_url=settings.SETUP_DEFAULT_UNIFI_BASE_URL,
        unifi_port=settings.SETUP_DEFAULT_UNIFI_PORT,
    )


@router.get("/status")
def get_setup_status(db: Session = Depends(get_db)) -> dict:
    has_superadmin = _has_superadmin(db)
    response = SetupStatusResponse(
        bootstrapped=has_superadmin,
        has_superadmin=has_superadmin,
        defaults=_default_setup_values(),
    )
    return {"ok": True, "data": response.model_dump(mode="json")}


@router.post("/bootstrap")
def bootstrap_setup(payload: SetupBootstrapRequest, request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        get_redis_client(),
        scope_key=limit_key_ip(client_ip, "setup_bootstrap"),
        limit=settings.SETUP_BOOTSTRAP_RATE_LIMIT_PER_IP,
        window_seconds=settings.SETUP_BOOTSTRAP_RATE_LIMIT_WINDOW_SECONDS,
    )

    if _has_superadmin(db):
        raise HTTPException(
            status_code=409,
            detail={
                "ok": False,
                "error": {
                    "code": "BOOTSTRAP_ALREADY_COMPLETED",
                    "message": "Setup has already been completed. Use admin settings instead.",
                },
            },
        )

    normalized_email = payload.admin_email.strip().lower()
    normalized_tenant_slug = payload.tenant_slug.strip().lower()
    existing_admin = db.execute(select(AdminUser).where(func.lower(AdminUser.email) == normalized_email)).scalar_one_or_none()
    if existing_admin:
        raise HTTPException(
            status_code=409,
            detail={"ok": False, "error": {"code": "EMAIL_TAKEN", "message": "Admin email is already in use."}},
        )

    existing_tenant_slug = db.execute(
        select(Tenant).where(func.lower(Tenant.slug) == normalized_tenant_slug)
    ).scalar_one_or_none()
    if existing_tenant_slug:
        raise HTTPException(
            status_code=409,
            detail={"ok": False, "error": {"code": "SLUG_TAKEN", "message": "Tenant slug is already in use."}},
        )

    if payload.create_initial_site and payload.site is None:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "SITE_REQUIRED", "message": "site payload is required when create_initial_site is true."},
            },
        )

    try:
        admin_user = AdminUser(
            id=uuid.uuid4(),
            email=normalized_email,
            password_hash=hash_password(payload.admin_password),
            is_superadmin=True,
        )
        tenant = Tenant(
            id=uuid.uuid4(),
            slug=normalized_tenant_slug,
            name=payload.tenant_name.strip(),
            status=TenantStatus.ACTIVE,
        )
        db.add(admin_user)
        db.add(tenant)
        db.flush()

        db.add(
            AdminMembership(
                admin_user_id=admin_user.id,
                tenant_id=tenant.id,
                role=AdminRole.TENANT_ADMIN,
            )
        )

        site_id: uuid.UUID | None = None
        if payload.create_initial_site and payload.site:
            site_payload = payload.site
            site_secret = _normalize_secret(site_payload.unifi_api_key)
            site = Site(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                slug=site_payload.site_slug.strip().lower(),
                display_name=site_payload.site_display_name.strip(),
                enabled=True,
                unifi_base_url=(site_payload.unifi_base_url or "").strip() or None,
                unifi_site_id=site_payload.unifi_site_id.strip(),
                default_time_limit_minutes=60,
                default_data_limit_mb=None,
                default_rx_kbps=None,
                default_tx_kbps=None,
                support_contact=None,
                portal_template_html=None,
                portal_template_enabled=False,
                portal_template_mode="off",
                portal_template_theme=None,
                enable_tos_only=False,
            )
            if site_secret:
                try:
                    site.unifi_api_key_encrypted = encrypt_secret(site_secret)
                except SecretError as exc:
                    raise HTTPException(
                        status_code=400,
                        detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
                    ) from exc
            db.add(site)
            db.flush()
            site_id = site.id

        db.commit()
    except HTTPException:
        db.rollback()
        raise
    except Exception:
        db.rollback()
        raise

    token = create_session_token(admin_user.id)
    response = JSONResponse(
        {
            "ok": True,
            "data": {
                "bootstrapped": True,
                "admin_user": {
                    "id": str(admin_user.id),
                    "email": admin_user.email,
                    "is_superadmin": admin_user.is_superadmin,
                },
                "tenant_id": str(tenant.id),
                "site_id": str(site_id) if site_id else None,
            },
        }
    )
    response.set_cookie(
        key=ADMIN_SESSION_COOKIE,
        value=token,
        httponly=True,
        samesite="lax",
        max_age=settings.ADMIN_SESSION_MAX_AGE_SECONDS,
        secure=settings.ADMIN_SESSION_COOKIE_SECURE,
    )
    return response
