from __future__ import annotations

import csv
import io
import json
import logging
import re
import secrets
import string
import time
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import false, func, or_, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import ADMIN_SESSION_COOKIE, get_current_admin, require_superadmin, require_tenant_role
from app.models import (
    AdminMembership,
    AdminRole,
    AdminUser,
    AuthEvent,
    AuthMethod,
    AuthResult,
    GuestIdentity,
    OidcProvider,
    PortalSession,
    PortalSessionStatus,
    Site,
    SiteOidcSetting,
    SitePortalTemplateVersion,
    Tenant,
    TenantStatus,
    Voucher,
    VoucherBatch,
    VoucherRedemption,
)
from app.redis import get_redis_client
from app.schemas.admin_dashboard import (
    DashboardDailyPoint,
    DashboardMethodBreakdown,
    DashboardOverview,
    DashboardSiteOption,
    DashboardSiteRollup,
    DashboardSummaryResponse,
)
from app.schemas.admin_report import (
    MethodDailyTrendResponse,
    MethodDailyTrendRow,
    SiteComparisonResponse,
    SiteComparisonRow,
)
from app.schemas.admin import AdminLoginRequest
from app.schemas.admin_oidc import (
    OidcProviderCreateRequest,
    OidcProviderResponse,
    OidcProviderUpdateRequest,
    SiteOidcResponse,
    SiteOidcUpdateRequest,
)
from app.schemas.admin_user import AdminUserCreateRequest, AdminUserResponse, AdminUserUpdateRequest
from app.schemas.admin_site import (
    PortalTemplateVersionResponse,
    SiteCreateRequest,
    SiteProvisionRequest,
    SiteResponse,
    SiteUpdateRequest,
    UnifiSiteDiscoveryResponse,
)
from app.schemas.admin_tenant import TenantCreateRequest, TenantResponse, TenantUpdateRequest
from app.schemas.admin_voucher import VoucherBatchCreateRequest
from app.security import create_session_token, hash_password, verify_password
from app.services.ratelimit import enforce_rate_limit, limit_key_email, limit_key_ip
from app.services.sanitization import sanitize_guest_html, sanitize_redirect_url
from app.services.secrets import SecretError, encrypt_secret, resolve_secret_value
from app.services.unifi import UnifiApiError, UnifiClient
from app.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

DEFAULT_PAGE_LIMIT = 50
MAX_PAGE_LIMIT = 200

@router.post("/login")
def login(payload: AdminLoginRequest, request: Request, db: Session = Depends(get_db)) -> JSONResponse:
    redis_client = get_redis_client()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_ip(client_ip, "admin_login"),
        limit=settings.ADMIN_LOGIN_RATE_LIMIT_PER_IP,
        window_seconds=settings.ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_email(payload.email, "admin_login"),
        limit=settings.ADMIN_LOGIN_RATE_LIMIT_PER_EMAIL,
        window_seconds=settings.ADMIN_LOGIN_RATE_LIMIT_WINDOW_SECONDS,
    )

    stmt = select(AdminUser).where(AdminUser.email == payload.email)
    admin = db.execute(stmt).scalar_one_or_none()
    if not admin or not verify_password(payload.password, admin.password_hash):
        raise HTTPException(
            status_code=401,
            detail={"ok": False, "error": {"code": "INVALID_CREDENTIALS", "message": "Invalid login."}},
        )

    token = create_session_token(admin.id)
    response = JSONResponse(
        {
            "ok": True,
            "data": {
                "admin_user": {"id": str(admin.id), "email": admin.email, "is_superadmin": admin.is_superadmin}
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


@router.post("/logout")
def logout() -> JSONResponse:
    response = JSONResponse({"ok": True, "data": {"signed_out": True}})
    response.delete_cookie(
        key=ADMIN_SESSION_COOKIE,
        samesite="lax",
        secure=settings.ADMIN_SESSION_COOKIE_SECURE,
    )
    return response


@router.get("/me")
def me(current_admin: AdminUser = Depends(get_current_admin)) -> dict:
    memberships = current_admin.memberships
    return {
        "ok": True,
        "data": {
            "admin_user": {
                "id": str(current_admin.id),
                "email": current_admin.email,
                "is_superadmin": current_admin.is_superadmin,
                "memberships": [
                    {"tenant_id": str(membership.tenant_id), "role": membership.role.value}
                    for membership in memberships
                ],
            }
        },
    }


@router.get("/tenants")
def list_tenants(
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    tenants = db.execute(select(Tenant)).scalars().all()
    return {
        "ok": True,
        "data": {
            "tenants": [
                _build_tenant_response(tenant)
                for tenant in tenants
            ]
        },
    }


@router.get("/tenants/{tenant_id}")
def get_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    return {
        "ok": True,
        "data": {
            "tenant": _build_tenant_response(tenant)
        },
    }


@router.get("/tenants/{tenant_id}/admins")
def list_admin_users(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    stmt = (
        select(AdminUser, AdminMembership)
        .join(AdminMembership, AdminMembership.admin_user_id == AdminUser.id)
        .where(AdminMembership.tenant_id == tenant_id)
        .order_by(AdminUser.created_at.asc())
    )
    rows = db.execute(stmt).all()
    admins = [
        AdminUserResponse(
            id=str(admin.id),
            email=admin.email,
            role=membership.role.value,
            is_superadmin=admin.is_superadmin,
            created_at=admin.created_at,
        ).model_dump(mode="json")
        for admin, membership in rows
    ]
    return {"ok": True, "data": {"admins": admins}}


@router.post("/tenants/{tenant_id}/admins")
def create_admin_user(
    tenant_id: uuid.UUID,
    payload: AdminUserCreateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )

    normalized_email = payload.email.strip().lower()
    admin_user = db.execute(
        select(AdminUser).where(func.lower(AdminUser.email) == normalized_email)
    ).scalar_one_or_none()

    if admin_user:
        membership = db.execute(
            select(AdminMembership).where(
                AdminMembership.admin_user_id == admin_user.id,
                AdminMembership.tenant_id == tenant_id,
            )
        ).scalar_one_or_none()
        if membership:
            raise HTTPException(
                status_code=409,
                detail={
                    "ok": False,
                    "error": {"code": "ADMIN_EXISTS", "message": "Admin already exists for tenant."},
                },
            )
    else:
        admin_user = AdminUser(
            email=normalized_email,
            password_hash=hash_password(payload.password),
            is_superadmin=False,
        )
        db.add(admin_user)
        db.flush()

    membership = AdminMembership(
        admin_user_id=admin_user.id,
        tenant_id=tenant_id,
        role=payload.role,
    )
    db.add(membership)
    db.commit()
    db.refresh(admin_user)

    return {
        "ok": True,
        "data": {
            "admin": AdminUserResponse(
                id=str(admin_user.id),
                email=admin_user.email,
                role=membership.role.value,
                is_superadmin=admin_user.is_superadmin,
                created_at=admin_user.created_at,
            ).model_dump(mode="json")
        },
    }


@router.put("/tenants/{tenant_id}/admins/{admin_user_id}")
def update_admin_user(
    tenant_id: uuid.UUID,
    admin_user_id: uuid.UUID,
    payload: AdminUserUpdateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    membership = db.execute(
        select(AdminMembership).where(
            AdminMembership.admin_user_id == admin_user_id,
            AdminMembership.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Admin membership not found."}},
        )

    admin_user = db.execute(select(AdminUser).where(AdminUser.id == admin_user_id)).scalar_one_or_none()
    if not admin_user:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Admin user not found."}},
        )

    if payload.email is not None:
        normalized_email = payload.email.strip().lower()
        existing = db.execute(
            select(AdminUser).where(
                func.lower(AdminUser.email) == normalized_email,
                AdminUser.id != admin_user_id,
            )
        ).scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=409,
                detail={
                    "ok": False,
                    "error": {"code": "EMAIL_TAKEN", "message": "Admin email is already in use."},
                },
            )
        admin_user.email = normalized_email
    if payload.password is not None:
        admin_user.password_hash = hash_password(payload.password)
    if payload.is_superadmin is not None:
        admin_user.is_superadmin = payload.is_superadmin
    if payload.role is not None:
        membership.role = payload.role

    db.add(admin_user)
    db.add(membership)
    db.commit()
    db.refresh(admin_user)

    return {
        "ok": True,
        "data": {
            "admin": AdminUserResponse(
                id=str(admin_user.id),
                email=admin_user.email,
                role=membership.role.value,
                is_superadmin=admin_user.is_superadmin,
                created_at=admin_user.created_at,
            ).model_dump(mode="json")
        },
    }


@router.delete("/tenants/{tenant_id}/admins/{admin_user_id}")
def delete_admin_user(
    tenant_id: uuid.UUID,
    admin_user_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    membership = db.execute(
        select(AdminMembership).where(
            AdminMembership.admin_user_id == admin_user_id,
            AdminMembership.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not membership:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Admin membership not found."}},
        )

    admin_user = db.execute(select(AdminUser).where(AdminUser.id == admin_user_id)).scalar_one_or_none()
    if not admin_user:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Admin user not found."}},
        )
    if admin_user.is_superadmin:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "SUPERADMIN_IMMUTABLE", "message": "Superadmin access cannot be removed."},
            },
        )

    db.delete(membership)
    remaining = db.execute(
        select(AdminMembership).where(AdminMembership.admin_user_id == admin_user_id)
    ).scalars().all()
    if not remaining:
        db.delete(admin_user)
    db.commit()

    return {"ok": True, "data": {"deleted": True}}

@router.post("/tenants")
def create_tenant(
    payload: TenantCreateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    status_value = (payload.status or TenantStatus.ACTIVE.value).strip().upper()
    try:
        status = TenantStatus(status_value)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": "INVALID_STATUS", "message": "Invalid tenant status."}},
        ) from exc

    normalized_slug = payload.slug.strip()
    existing_slug = db.execute(
        select(Tenant).where(func.lower(Tenant.slug) == normalized_slug.lower())
    ).scalar_one_or_none()
    if existing_slug:
        raise HTTPException(
            status_code=409,
            detail={"ok": False, "error": {"code": "SLUG_TAKEN", "message": "Tenant slug is already in use."}},
        )

    unifi_api_key = _normalize_secret_value(payload.unifi_api_key)

    tenant = Tenant(
        id=uuid.uuid4(),
        slug=normalized_slug,
        name=payload.name,
        status=status,
        unifi_base_url=_empty_to_none(payload.unifi_base_url),
        unifi_api_key_ref=_empty_to_none(payload.unifi_api_key_ref),
    )
    if unifi_api_key:
        try:
            tenant.unifi_api_key_encrypted = encrypt_secret(unifi_api_key)
        except SecretError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
            ) from exc
        if payload.unifi_api_key_ref in (None, ""):
            tenant.unifi_api_key_ref = None
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return {
        "ok": True,
        "data": {
            "tenant": _build_tenant_response(tenant)
        },
    }


@router.put("/tenants/{tenant_id}")
def update_tenant(
    tenant_id: uuid.UUID,
    payload: TenantUpdateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )

    if payload.status is not None:
        status_value = payload.status.strip().upper()
        try:
            tenant.status = TenantStatus(status_value)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_STATUS", "message": "Invalid tenant status."}},
            ) from exc
    if payload.name is not None:
        tenant.name = payload.name
    if payload.slug is not None:
        normalized_slug = payload.slug.strip()
        existing_slug = db.execute(
            select(Tenant).where(
                func.lower(Tenant.slug) == normalized_slug.lower(),
                Tenant.id != tenant_id,
            )
        ).scalar_one_or_none()
        if existing_slug:
            raise HTTPException(
                status_code=409,
                detail={"ok": False, "error": {"code": "SLUG_TAKEN", "message": "Tenant slug is already in use."}},
            )
        tenant.slug = normalized_slug
    if payload.unifi_base_url is not None:
        tenant.unifi_base_url = _empty_to_none(payload.unifi_base_url)
    if payload.unifi_api_key_ref is not None:
        tenant.unifi_api_key_ref = _empty_to_none(payload.unifi_api_key_ref)
    unifi_api_key = _normalize_secret_value(payload.unifi_api_key)
    if unifi_api_key is not None:
        if unifi_api_key == "":
            tenant.unifi_api_key_encrypted = None
        else:
            try:
                tenant.unifi_api_key_encrypted = encrypt_secret(unifi_api_key)
            except SecretError as exc:
                raise HTTPException(
                    status_code=400,
                    detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
                ) from exc
            if payload.unifi_api_key_ref in (None, ""):
                tenant.unifi_api_key_ref = None
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return {
        "ok": True,
        "data": {
            "tenant": _build_tenant_response(tenant)
        },
    }


@router.delete("/tenants/{tenant_id}")
def delete_tenant(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_superadmin),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    db.delete(tenant)
    db.commit()
    return {"ok": True, "data": {"deleted": True}}


@router.get("/tenants/{tenant_id}/unifi/sites")
def discover_unifi_sites(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    if not tenant.unifi_base_url or not (tenant.unifi_api_key_ref or tenant.unifi_api_key_encrypted):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )
    try:
        api_key = resolve_secret_value(
            encrypted=tenant.unifi_api_key_encrypted,
            ref=tenant.unifi_api_key_ref,
            missing_code="UNIFI_CONFIG_REQUIRED",
            missing_message="UniFi controller settings are required.",
        )
    except SecretError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    client = UnifiClient(
        tenant.unifi_base_url,
        api_key,
        "tenant",
        tenant_id=str(tenant.id),
        verify_ssl=settings.UNIFI_VERIFY_SSL,
    )
    try:
        sites = client.list_sites()
    except UnifiApiError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_ERROR", "message": "UniFi site discovery failed."},
            },
        ) from exc

    existing = set(db.execute(select(Site.unifi_site_id).where(Site.tenant_id == tenant_id)).scalars().all())

    data = []
    for site in sites:
        site_id = site.get("id") or site.get("siteId")
        if not site_id:
            continue
        name = site.get("name")
        internal = site.get("internalReference")
        suggested = _slugify(name or internal or site_id)
        data.append(
            UnifiSiteDiscoveryResponse(
                id=site_id,
                name=name,
                internal_reference=internal,
                provisioned=site_id in existing,
                suggested_slug=suggested,
            ).model_dump(mode="json")
        )
    return {"ok": True, "data": {"sites": data}}


@router.post("/tenants/{tenant_id}/sites/provision")
def provision_sites(
    tenant_id: uuid.UUID,
    payload: SiteProvisionRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    if not tenant.unifi_base_url or not (tenant.unifi_api_key_ref or tenant.unifi_api_key_encrypted):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )
    try:
        api_key = resolve_secret_value(
            encrypted=tenant.unifi_api_key_encrypted,
            ref=tenant.unifi_api_key_ref,
            missing_code="UNIFI_CONFIG_REQUIRED",
            missing_message="UniFi controller settings are required.",
        )
    except SecretError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    client = UnifiClient(
        tenant.unifi_base_url,
        api_key,
        "tenant",
        tenant_id=str(tenant.id),
        verify_ssl=settings.UNIFI_VERIFY_SSL,
    )
    try:
        unifi_sites = {site.get("id") or site.get("siteId"): site for site in client.list_sites()}
    except UnifiApiError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_ERROR", "message": "UniFi site discovery failed."},
            },
        ) from exc

    existing_sites = db.execute(select(Site).where(Site.tenant_id == tenant_id)).scalars().all()
    existing_unifi_ids = {site.unifi_site_id for site in existing_sites}
    existing_slugs = {site.slug for site in existing_sites}

    desired_slugs: set[str] = set()
    to_create: list[Site] = []

    for item in payload.sites:
        site_id = item.unifi_site_id.strip()
        if site_id in existing_unifi_ids:
            continue
        unifi_site = unifi_sites.get(site_id)
        if not unifi_site:
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {"code": "UNIFI_SITE_NOT_FOUND", "message": "UniFi site id not found."},
                },
            )
        display_name = (
            _empty_to_none(item.display_name)
            or unifi_site.get("name")
            or unifi_site.get("internalReference")
            or site_id
        )
        slug = _empty_to_none(item.slug) or _slugify(display_name)
        if not slug:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_SLUG", "message": "Site slug is required."}},
            )
        if slug in existing_slugs or slug in desired_slugs:
            raise HTTPException(
                status_code=409,
                detail={"ok": False, "error": {"code": "SLUG_TAKEN", "message": f"Slug '{slug}' is already in use."}},
            )
        desired_slugs.add(slug)
        to_create.append(
            Site(
                tenant_id=tenant_id,
                slug=slug,
                display_name=display_name,
                enabled=item.enabled,
                logo_url=None,
                primary_color=None,
                terms_html=None,
                portal_template_html=None,
                portal_template_enabled=False,
                portal_template_mode="off",
                portal_template_theme=None,
                support_contact=None,
                success_url=None,
                enable_tos_only=False,
                unifi_base_url=None,
                unifi_site_id=site_id,
                unifi_api_key_ref=None,
                default_time_limit_minutes=60,
                default_data_limit_mb=None,
                default_rx_kbps=None,
                default_tx_kbps=None,
            )
        )

    if not to_create:
        return {"ok": True, "data": {"sites": []}}

    db.add_all(to_create)
    db.commit()
    for site in to_create:
        db.refresh(site)
    return {"ok": True, "data": {"sites": [_site_response(site).model_dump(mode="json") for site in to_create]}}


@router.post("/tenants/{tenant_id}/sites")
def create_site(
    tenant_id: uuid.UUID,
    payload: SiteCreateRequest,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )

    base_url = _empty_to_none(payload.unifi_base_url) or tenant.unifi_base_url
    api_key_ref = _empty_to_none(payload.unifi_api_key_ref) or tenant.unifi_api_key_ref
    api_key_encrypted = tenant.unifi_api_key_encrypted
    unifi_api_key = _normalize_secret_value(payload.unifi_api_key)
    has_payload_key = unifi_api_key not in (None, "")
    if not base_url or not (api_key_ref or api_key_encrypted or has_payload_key):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )

    portal_template_html = sanitize_guest_html(_empty_to_none(payload.portal_template_html))
    terms_html = sanitize_guest_html(_empty_to_none(payload.terms_html))
    success_url = _normalize_success_url(payload.success_url)
    portal_template_mode = _resolve_portal_template_mode(
        mode=payload.portal_template_mode,
        enabled=payload.portal_template_enabled,
        html=portal_template_html,
    )
    _validate_portal_template(portal_template_mode, portal_template_html)

    site = Site(
        tenant_id=tenant_id,
        slug=payload.slug,
        display_name=payload.display_name,
        enabled=payload.enabled,
        logo_url=_empty_to_none(payload.logo_url),
        primary_color=_empty_to_none(payload.primary_color),
        terms_html=terms_html,
        portal_template_html=portal_template_html,
        portal_template_enabled=portal_template_mode != "off",
        portal_template_mode=portal_template_mode,
        portal_template_theme=_normalize_portal_template_theme(payload.portal_template_theme),
        support_contact=_empty_to_none(payload.support_contact),
        success_url=success_url,
        enable_tos_only=payload.enable_tos_only,
        unifi_base_url=_empty_to_none(payload.unifi_base_url),
        unifi_site_id=payload.unifi_site_id.strip(),
        unifi_api_key_ref=_empty_to_none(payload.unifi_api_key_ref),
        default_time_limit_minutes=payload.default_time_limit_minutes,
        default_data_limit_mb=payload.default_data_limit_mb,
        default_rx_kbps=payload.default_rx_kbps,
        default_tx_kbps=payload.default_tx_kbps,
    )
    if unifi_api_key is not None:
        if unifi_api_key == "":
            site.unifi_api_key_encrypted = None
        else:
            try:
                site.unifi_api_key_encrypted = encrypt_secret(unifi_api_key)
            except SecretError as exc:
                raise HTTPException(
                    status_code=400,
                    detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
                ) from exc
            if payload.unifi_api_key_ref in (None, ""):
                site.unifi_api_key_ref = None
    db.add(site)
    _snapshot_site_portal_template(
        db,
        site=site,
        created_by_admin_user_id=admin_user.id,
    )
    db.commit()
    db.refresh(site)
    return {"ok": True, "data": {"site": _site_response(site).model_dump(mode="json")}}


@router.get("/tenants/{tenant_id}/sites")
def list_sites(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    sites = db.execute(select(Site).where(Site.tenant_id == tenant_id)).scalars().all()
    return {
        "ok": True,
        "data": {
            "sites": [
                {
                    "id": str(site.id),
                    "slug": site.slug,
                    "display_name": site.display_name,
                    "enabled": site.enabled,
                    "unifi_site_id": site.unifi_site_id,
                }
                for site in sites
            ]
        },
    }


@router.get("/tenants/{tenant_id}/sites/{site_id}")
def get_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
    )
    return {"ok": True, "data": {"site": _site_response(site).model_dump(mode="json")}}


@router.get("/tenants/{tenant_id}/sites/{site_id}/portal-template-versions")
def list_site_portal_template_versions(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    limit: int = 20,
    offset: int = 0,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    page_limit, page_offset = _validate_pagination(limit=limit, offset=offset)
    query = (
        select(SitePortalTemplateVersion)
        .where(
            SitePortalTemplateVersion.tenant_id == tenant_id,
            SitePortalTemplateVersion.site_id == site_id,
        )
        .order_by(SitePortalTemplateVersion.created_at.desc())
    )
    total = db.execute(select(func.count()).select_from(query.order_by(None).subquery())).scalar_one()
    versions = db.execute(query.limit(page_limit).offset(page_offset)).scalars().all()
    payload = [
        PortalTemplateVersionResponse(
            id=str(version.id),
            site_id=str(version.site_id),
            tenant_id=str(version.tenant_id),
            portal_template_mode=version.portal_template_mode,
            portal_template_html=version.portal_template_html,
            portal_template_theme=version.portal_template_theme,
            created_by_admin_user_id=(
                str(version.created_by_admin_user_id) if version.created_by_admin_user_id else None
            ),
            created_at=version.created_at.isoformat(),
        ).model_dump(mode="json")
        for version in versions
    ]
    return {
        "ok": True,
        "data": {
            "versions": payload,
            "pagination": {
                "limit": page_limit,
                "offset": page_offset,
                "total": total,
                "has_more": page_offset + page_limit < total,
            },
        },
    }


@router.post("/tenants/{tenant_id}/sites/{site_id}/portal-template-versions/{version_id}/restore")
def restore_site_portal_template_version(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    version_id: uuid.UUID,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    version = db.execute(
        select(SitePortalTemplateVersion).where(
            SitePortalTemplateVersion.id == version_id,
            SitePortalTemplateVersion.tenant_id == tenant_id,
            SitePortalTemplateVersion.site_id == site_id,
        )
    ).scalar_one_or_none()
    if not version:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Template version not found."}},
        )

    restored_template_html = sanitize_guest_html(version.portal_template_html)
    _validate_portal_template(version.portal_template_mode, restored_template_html)
    site.portal_template_mode = version.portal_template_mode
    site.portal_template_enabled = version.portal_template_mode != "off"
    site.portal_template_html = restored_template_html
    site.portal_template_theme = version.portal_template_theme

    db.add(site)
    _snapshot_site_portal_template(
        db,
        site=site,
        created_by_admin_user_id=admin_user.id,
    )
    db.commit()
    db.refresh(site)

    return {
        "ok": True,
        "data": {
            "site": _site_response(site).model_dump(mode="json"),
            "restored_version_id": str(version.id),
        },
    }


@router.put("/tenants/{tenant_id}/sites/{site_id}")
def update_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    payload: SiteUpdateRequest,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    previous_template_state = _portal_template_state(site)

    if payload.display_name is not None:
        site.display_name = payload.display_name
    if payload.slug is not None:
        site.slug = payload.slug
    if payload.enabled is not None:
        site.enabled = payload.enabled
    if payload.logo_url is not None:
        site.logo_url = _empty_to_none(payload.logo_url)
    if payload.primary_color is not None:
        site.primary_color = _empty_to_none(payload.primary_color)
    if payload.terms_html is not None:
        site.terms_html = sanitize_guest_html(_empty_to_none(payload.terms_html))
    next_portal_template_html = site.portal_template_html
    if payload.portal_template_html is not None:
        next_portal_template_html = sanitize_guest_html(_empty_to_none(payload.portal_template_html))
        site.portal_template_html = next_portal_template_html
    if payload.portal_template_theme is not None:
        site.portal_template_theme = _normalize_portal_template_theme(payload.portal_template_theme)
    portal_mode_needs_update = (
        payload.portal_template_mode is not None
        or payload.portal_template_enabled is not None
        or payload.portal_template_html is not None
    )
    if portal_mode_needs_update:
        resolved_portal_mode = _resolve_portal_template_mode(
            mode=payload.portal_template_mode,
            enabled=payload.portal_template_enabled,
            html=next_portal_template_html,
            current_mode=site.portal_template_mode,
        )
        _validate_portal_template(resolved_portal_mode, next_portal_template_html)
        site.portal_template_mode = resolved_portal_mode
        site.portal_template_enabled = resolved_portal_mode != "off"
    if payload.support_contact is not None:
        site.support_contact = _empty_to_none(payload.support_contact)
    if payload.success_url is not None:
        site.success_url = _normalize_success_url(payload.success_url)
    if payload.enable_tos_only is not None:
        site.enable_tos_only = payload.enable_tos_only
    if payload.unifi_base_url is not None:
        site.unifi_base_url = _empty_to_none(payload.unifi_base_url)
    if payload.unifi_site_id is not None:
        site.unifi_site_id = _empty_to_none(payload.unifi_site_id) or site.unifi_site_id
    if payload.unifi_api_key_ref is not None:
        site.unifi_api_key_ref = _empty_to_none(payload.unifi_api_key_ref)
    unifi_api_key = _normalize_secret_value(payload.unifi_api_key)
    if unifi_api_key is not None:
        if unifi_api_key == "":
            site.unifi_api_key_encrypted = None
        else:
            try:
                site.unifi_api_key_encrypted = encrypt_secret(unifi_api_key)
            except SecretError as exc:
                raise HTTPException(
                    status_code=400,
                    detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
                ) from exc
            if payload.unifi_api_key_ref in (None, ""):
                site.unifi_api_key_ref = None
    if payload.default_time_limit_minutes is not None:
        site.default_time_limit_minutes = payload.default_time_limit_minutes
    if payload.default_data_limit_mb is not None:
        site.default_data_limit_mb = payload.default_data_limit_mb
    if payload.default_rx_kbps is not None:
        site.default_rx_kbps = payload.default_rx_kbps
    if payload.default_tx_kbps is not None:
        site.default_tx_kbps = payload.default_tx_kbps

    if not (site.unifi_base_url or tenant.unifi_base_url) or not (
        site.unifi_api_key_ref
        or tenant.unifi_api_key_ref
        or site.unifi_api_key_encrypted
        or tenant.unifi_api_key_encrypted
    ):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )

    db.add(site)
    if _portal_template_state(site) != previous_template_state:
        _snapshot_site_portal_template(
            db,
            site=site,
            created_by_admin_user_id=admin_user.id,
        )
    db.commit()
    db.refresh(site)
    return {"ok": True, "data": {"site": _site_response(site).model_dump(mode="json")}}


@router.delete("/tenants/{tenant_id}/sites/{site_id}")
def delete_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    db.delete(site)
    db.commit()
    return {"ok": True, "data": {"deleted": True}}


@router.post("/tenants/{tenant_id}/sites/{site_id}/unifi-test")
def test_unifi_connection(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )

    base_url, api_key = _resolve_unifi_credentials(site, tenant)

    start = time.monotonic()
    client = UnifiClient(
        base_url,
        api_key,
        site.unifi_site_id,
        tenant_id=str(site.tenant_id),
        site_uuid=str(site.id),
        verify_ssl=settings.UNIFI_VERIFY_SSL,
    )
    try:
        sites = client.list_sites()
    except UnifiApiError as exc:
        raise HTTPException(
            status_code=502,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_ERROR", "message": "UniFi API test failed."},
            },
        ) from exc

    latency_ms = int((time.monotonic() - start) * 1000)
    data = next((item for item in sites if item.get("id") == site.unifi_site_id), None)
    if not data:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "UNIFI_SITE_NOT_FOUND",
                    "message": "UniFi site id not found. Use the site id from /v1/sites.",
                },
            },
        )
    return {
        "ok": True,
        "data": {
            "status": "ok",
            "latency_ms": latency_ms,
            "site": data,
        },
    }


@router.get("/tenants/{tenant_id}/oidc-providers")
def list_oidc_providers(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    providers = db.execute(select(OidcProvider).where(OidcProvider.tenant_id == tenant_id)).scalars().all()
    return {
        "ok": True,
        "data": {
            "providers": [
                OidcProviderResponse(
                    id=provider.id,
                    issuer=provider.issuer,
                    client_id=provider.client_id,
                    client_secret_ref=provider.client_secret_ref,
                    client_secret_stored=bool(provider.client_secret_encrypted),
                    scopes=provider.scopes,
                ).model_dump(mode="json")
                for provider in providers
            ]
        },
    }


@router.post("/tenants/{tenant_id}/oidc-providers")
def create_oidc_provider(
    tenant_id: uuid.UUID,
    payload: OidcProviderCreateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    client_secret = _normalize_secret_value(payload.client_secret)
    if client_secret in (None, "") and not _empty_to_none(payload.client_secret_ref):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "OIDC_SECRET_REQUIRED", "message": "OIDC client secret is required."},
            },
        )
    provider = OidcProvider(
        tenant_id=tenant_id,
        issuer=payload.issuer,
        client_id=payload.client_id,
        client_secret_ref=_empty_to_none(payload.client_secret_ref),
        scopes=payload.scopes,
    )
    if client_secret:
        try:
            provider.client_secret_encrypted = encrypt_secret(client_secret)
        except SecretError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
            ) from exc
        if payload.client_secret_ref in (None, ""):
            provider.client_secret_ref = None
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return {
        "ok": True,
        "data": {
            "provider": OidcProviderResponse(
                id=provider.id,
                issuer=provider.issuer,
                client_id=provider.client_id,
                client_secret_ref=provider.client_secret_ref,
                client_secret_stored=bool(provider.client_secret_encrypted),
                scopes=provider.scopes,
            ).model_dump(mode="json")
        },
    }


@router.get("/tenants/{tenant_id}/oidc-providers/{provider_id}")
def get_oidc_provider(
    tenant_id: uuid.UUID,
    provider_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    provider = db.execute(
        select(OidcProvider).where(OidcProvider.id == provider_id, OidcProvider.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not provider:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Provider not found."}},
        )
    return {
        "ok": True,
        "data": {
            "provider": OidcProviderResponse(
                id=provider.id,
                issuer=provider.issuer,
                client_id=provider.client_id,
                client_secret_ref=provider.client_secret_ref,
                client_secret_stored=bool(provider.client_secret_encrypted),
                scopes=provider.scopes,
            ).model_dump(mode="json")
        },
    }


@router.put("/tenants/{tenant_id}/oidc-providers/{provider_id}")
def update_oidc_provider(
    tenant_id: uuid.UUID,
    provider_id: uuid.UUID,
    payload: OidcProviderUpdateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    provider = db.execute(
        select(OidcProvider).where(OidcProvider.id == provider_id, OidcProvider.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not provider:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Provider not found."}},
        )
    if payload.issuer is not None:
        provider.issuer = payload.issuer
    if payload.client_id is not None:
        provider.client_id = payload.client_id
    if payload.client_secret_ref is not None:
        provider.client_secret_ref = _empty_to_none(payload.client_secret_ref)
    client_secret = _normalize_secret_value(payload.client_secret)
    if client_secret is not None:
        if client_secret == "":
            provider.client_secret_encrypted = None
        else:
            try:
                provider.client_secret_encrypted = encrypt_secret(client_secret)
            except SecretError as exc:
                raise HTTPException(
                    status_code=400,
                    detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
                ) from exc
            if payload.client_secret_ref in (None, ""):
                provider.client_secret_ref = None
    if payload.scopes is not None:
        provider.scopes = payload.scopes
    if not (provider.client_secret_ref or provider.client_secret_encrypted):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "OIDC_SECRET_REQUIRED", "message": "OIDC client secret is required."},
            },
        )
    db.add(provider)
    db.commit()
    db.refresh(provider)
    return {
        "ok": True,
        "data": {
            "provider": OidcProviderResponse(
                id=provider.id,
                issuer=provider.issuer,
                client_id=provider.client_id,
                client_secret_ref=provider.client_secret_ref,
                client_secret_stored=bool(provider.client_secret_encrypted),
                scopes=provider.scopes,
            ).model_dump(mode="json")
        },
    }


@router.delete("/tenants/{tenant_id}/oidc-providers/{provider_id}")
def delete_oidc_provider(
    tenant_id: uuid.UUID,
    provider_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    provider = db.execute(
        select(OidcProvider).where(OidcProvider.id == provider_id, OidcProvider.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not provider:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Provider not found."}},
        )
    db.delete(provider)
    db.commit()
    return {"ok": True, "data": {"deleted": True}}


@router.put("/tenants/{tenant_id}/sites/{site_id}/oidc")
def update_site_oidc(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    payload: SiteOidcUpdateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    provider = db.execute(
        select(OidcProvider).where(
            OidcProvider.id == payload.oidc_provider_id,
            OidcProvider.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not provider:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Provider not found."}},
        )

    setting = db.execute(select(SiteOidcSetting).where(SiteOidcSetting.site_id == site_id)).scalar_one_or_none()
    if setting:
        setting.provider_id = provider.id
        setting.enabled = payload.enabled
        setting.allowed_domains = _normalize_domains(payload.allowed_email_domains)
    else:
        setting = SiteOidcSetting(
            site_id=site.id,
            provider_id=provider.id,
            enabled=payload.enabled,
            allowed_domains=_normalize_domains(payload.allowed_email_domains),
        )
        db.add(setting)
    db.commit()
    db.refresh(setting)
    return {
        "ok": True,
        "data": {
            "site_oidc": SiteOidcResponse(
                enabled=setting.enabled,
                oidc_provider_id=setting.provider_id,
                allowed_email_domains=_parse_domains(setting.allowed_domains),
            ).model_dump(mode="json")
        },
    }


@router.post("/tenants/{tenant_id}/sites/{site_id}/vouchers/batches")
def create_voucher_batch(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    payload: VoucherBatchCreateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    site = db.execute(
        select(Site).where(Site.id == site_id, Site.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    expires_at = None
    if payload.expires_at:
        try:
            expires_at = datetime.fromisoformat(payload.expires_at)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_DATE", "message": "Invalid expires_at."}},
            ) from exc

    batch = VoucherBatch(
        tenant_id=tenant_id,
        site_id=site_id,
        name=payload.name,
        expires_at=expires_at,
        max_uses_per_code=payload.max_uses_per_code,
    )
    db.add(batch)
    db.flush()

    codes = _generate_codes(payload.count, payload.code_length)
    vouchers = [Voucher(batch_id=batch.id, code=code, uses=0, disabled=False) for code in codes]
    db.add_all(vouchers)
    db.commit()

    return {"ok": True, "data": {"batch_id": str(batch.id), "count": payload.count}}


@router.get("/tenants/{tenant_id}/sites/{site_id}/vouchers/batches/{batch_id}/export.csv")
def export_voucher_batch(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    batch_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> StreamingResponse:
    batch = db.execute(
        select(VoucherBatch).where(
            VoucherBatch.id == batch_id,
            VoucherBatch.site_id == site_id,
            VoucherBatch.tenant_id == tenant_id,
        )
    ).scalar_one_or_none()
    if not batch:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Batch not found."}},
        )

    vouchers = db.execute(select(Voucher).where(Voucher.batch_id == batch_id)).scalars().all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["code"])
    for voucher in vouchers:
        writer.writerow([voucher.code])
    output.seek(0)

    headers = {"Content-Disposition": f"attachment; filename=vouchers-{batch_id}.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


@router.get("/tenants/{tenant_id}/auth-events")
def list_auth_events(
    tenant_id: uuid.UUID,
    method: str | None = None,
    result: str | None = None,
    search: str | None = None,
    site_id: uuid.UUID | None = None,
    limit: int = DEFAULT_PAGE_LIMIT,
    offset: int = 0,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    page_limit, page_offset = _validate_pagination(limit=limit, offset=offset)
    if site_id is not None:
        _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    query = _auth_events_query([tenant_id], method, result, search, site_id)
    total = db.execute(select(func.count()).select_from(query.order_by(None).subquery())).scalar_one()
    events = db.execute(query.limit(page_limit).offset(page_offset)).scalars().all()
    payload = [_serialize_auth_event(event) for event in events]
    return {
        "ok": True,
        "data": {
            "events": payload,
            "pagination": {
                "limit": page_limit,
                "offset": page_offset,
                "total": total,
                "has_more": page_offset + page_limit < total,
            },
        },
    }


@router.get("/auth-events")
def list_auth_events_all_tenants(
    method: str | None = None,
    result: str | None = None,
    search: str | None = None,
    site_id: uuid.UUID | None = None,
    limit: int = DEFAULT_PAGE_LIMIT,
    offset: int = 0,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> dict:
    page_limit, page_offset = _validate_pagination(limit=limit, offset=offset)
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    query = _auth_events_query(tenant_ids, method, result, search, site_id)
    total = db.execute(select(func.count()).select_from(query.order_by(None).subquery())).scalar_one()
    events = db.execute(query.limit(page_limit).offset(page_offset)).scalars().all()
    payload = [_serialize_auth_event(event) for event in events]
    return {
        "ok": True,
        "data": {
            "events": payload,
            "pagination": {
                "limit": page_limit,
                "offset": page_offset,
                "total": total,
                "has_more": page_offset + page_limit < total,
            },
        },
    }


@router.get("/sites/options")
def list_accessible_site_options(
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> dict:
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    payload = [
        DashboardSiteOption(id=str(site_id), display_name=display_name).model_dump(mode="json")
        for site_id, display_name in sorted(site_options.items(), key=lambda item: item[1].lower())
    ]
    return {"ok": True, "data": {"sites": payload}}


@router.get("/tenants/{tenant_id}/dashboard/summary")
def dashboard_summary(
    tenant_id: uuid.UUID,
    days: int = 30,
    site_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    period_days = _validate_dashboard_days(days)
    site_rows = db.execute(
        select(Site.id, Site.display_name).where(Site.tenant_id == tenant_id)
    ).all()
    site_options = {row.id: row.display_name for row in site_rows}
    summary = _build_dashboard_summary(
        db,
        tenant_ids=[tenant_id],
        period_days=period_days,
        site_id=site_id,
        site_options=site_options,
    )
    return {"ok": True, "data": summary.model_dump(mode="json")}


@router.get("/dashboard/summary")
def dashboard_summary_all_tenants(
    days: int = 30,
    site_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> dict:
    period_days = _validate_dashboard_days(days)
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)

    summary = _build_dashboard_summary(
        db,
        tenant_ids=tenant_ids,
        period_days=period_days,
        site_id=site_id,
        site_options=site_options,
    )
    return {"ok": True, "data": summary.model_dump(mode="json")}


@router.get("/tenants/{tenant_id}/reports/method-daily")
def method_daily_report(
    tenant_id: uuid.UUID,
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    period_days = _validate_dashboard_days(days)
    if site_id is not None:
        _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    parsed_method = _parse_auth_method(method)
    report = _build_method_daily_report(
        db,
        tenant_ids=[tenant_id],
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
    )
    return {"ok": True, "data": report.model_dump(mode="json")}


@router.get("/reports/method-daily")
def method_daily_report_all_tenants(
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> dict:
    period_days = _validate_dashboard_days(days)
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    parsed_method = _parse_auth_method(method)
    report = _build_method_daily_report(
        db,
        tenant_ids=tenant_ids,
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
    )
    return {"ok": True, "data": report.model_dump(mode="json")}


@router.get("/tenants/{tenant_id}/reports/method-daily/export.csv")
def export_method_daily_report(
    tenant_id: uuid.UUID,
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> StreamingResponse:
    period_days = _validate_dashboard_days(days)
    if site_id is not None:
        _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    parsed_method = _parse_auth_method(method)
    report = _build_method_daily_report(
        db,
        tenant_ids=[tenant_id],
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["day", "method", "attempts", "success", "fail", "success_rate"])
    for row in report.rows:
        writer.writerow([row.day, row.method, row.attempts, row.success, row.fail, row.success_rate])
    output.seek(0)

    headers = {"Content-Disposition": "attachment; filename=method-daily-report.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


@router.get("/reports/method-daily/export.csv")
def export_method_daily_report_all_tenants(
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> StreamingResponse:
    period_days = _validate_dashboard_days(days)
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    parsed_method = _parse_auth_method(method)
    report = _build_method_daily_report(
        db,
        tenant_ids=tenant_ids,
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["day", "method", "attempts", "success", "fail", "success_rate"])
    for row in report.rows:
        writer.writerow([row.day, row.method, row.attempts, row.success, row.fail, row.success_rate])
    output.seek(0)

    headers = {"Content-Disposition": "attachment; filename=method-daily-report.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


@router.get("/tenants/{tenant_id}/reports/site-comparison")
def site_comparison_report(
    tenant_id: uuid.UUID,
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    period_days = _validate_dashboard_days(days)
    if site_id is not None:
        _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    parsed_method = _parse_auth_method(method)
    site_rows = db.execute(
        select(Site.id, Site.display_name).where(Site.tenant_id == tenant_id)
    ).all()
    site_options = {row.id: row.display_name for row in site_rows}
    report = _build_site_comparison_report(
        db,
        tenant_ids=[tenant_id],
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
        site_options=site_options,
    )
    return {"ok": True, "data": report.model_dump(mode="json")}


@router.get("/reports/site-comparison")
def site_comparison_report_all_tenants(
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> dict:
    period_days = _validate_dashboard_days(days)
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    parsed_method = _parse_auth_method(method)
    report = _build_site_comparison_report(
        db,
        tenant_ids=tenant_ids,
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
        site_options=site_options,
    )
    return {"ok": True, "data": report.model_dump(mode="json")}


@router.get("/tenants/{tenant_id}/reports/site-comparison/export.csv")
def export_site_comparison_report(
    tenant_id: uuid.UUID,
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> StreamingResponse:
    period_days = _validate_dashboard_days(days)
    if site_id is not None:
        _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    parsed_method = _parse_auth_method(method)
    site_rows = db.execute(
        select(Site.id, Site.display_name).where(Site.tenant_id == tenant_id)
    ).all()
    site_options = {row.id: row.display_name for row in site_rows}
    report = _build_site_comparison_report(
        db,
        tenant_ids=[tenant_id],
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
        site_options=site_options,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "site_id",
            "site_name",
            "auth_attempts",
            "auth_success",
            "auth_fail",
            "success_rate",
            "voucher_redemptions",
            "tos_clicks",
        ]
    )
    for row in report.rows:
        writer.writerow(
            [
                row.site_id,
                row.site_name,
                row.auth_attempts,
                row.auth_success,
                row.auth_fail,
                row.success_rate,
                row.voucher_redemptions,
                row.tos_clicks,
            ]
        )
    output.seek(0)

    headers = {"Content-Disposition": "attachment; filename=site-comparison-report.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


@router.get("/reports/site-comparison/export.csv")
def export_site_comparison_report_all_tenants(
    days: int = 30,
    site_id: uuid.UUID | None = None,
    method: str | None = None,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> StreamingResponse:
    period_days = _validate_dashboard_days(days)
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    parsed_method = _parse_auth_method(method)
    report = _build_site_comparison_report(
        db,
        tenant_ids=tenant_ids,
        period_days=period_days,
        site_id=site_id,
        method=parsed_method,
        site_options=site_options,
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "site_id",
            "site_name",
            "auth_attempts",
            "auth_success",
            "auth_fail",
            "success_rate",
            "voucher_redemptions",
            "tos_clicks",
        ]
    )
    for row in report.rows:
        writer.writerow(
            [
                row.site_id,
                row.site_name,
                row.auth_attempts,
                row.auth_success,
                row.auth_fail,
                row.success_rate,
                row.voucher_redemptions,
                row.tos_clicks,
            ]
        )
    output.seek(0)

    headers = {"Content-Disposition": "attachment; filename=site-comparison-report.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


@router.get("/tenants/{tenant_id}/auth-events/export.csv")
def export_auth_events(
    tenant_id: uuid.UUID,
    method: str | None = None,
    result: str | None = None,
    search: str | None = None,
    site_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> StreamingResponse:
    if site_id is not None:
        _require_site_in_tenant(db, tenant_id=tenant_id, site_id=site_id)
    query = _auth_events_query([tenant_id], method, result, search, site_id)
    events = db.execute(query).scalars().all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "timestamp",
            "site_id",
            "method",
            "result",
            "reason",
            "portal_session_id",
            "guest_identity_id",
        ]
    )
    for event in events:
        writer.writerow(
            [
                event.created_at.isoformat(),
                str(event.site_id),
                event.method.value.lower(),
                event.result.value.lower(),
                event.reason or "",
                str(event.portal_session_id) if event.portal_session_id else "",
                str(event.guest_identity_id) if event.guest_identity_id else "",
            ]
        )
    output.seek(0)
    headers = {"Content-Disposition": "attachment; filename=auth-events.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


@router.get("/auth-events/export.csv")
def export_auth_events_all_tenants(
    method: str | None = None,
    result: str | None = None,
    search: str | None = None,
    site_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
    admin_user: AdminUser = Depends(get_current_admin),
) -> StreamingResponse:
    tenant_ids, tenant_names = _resolve_accessible_tenants(db, admin_user)
    site_options = _build_site_options_for_tenants(db, tenant_ids=tenant_ids, tenant_names=tenant_names)
    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    query = _auth_events_query(tenant_ids, method, result, search, site_id)
    events = db.execute(query).scalars().all()
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        [
            "timestamp",
            "site_id",
            "method",
            "result",
            "reason",
            "portal_session_id",
            "guest_identity_id",
        ]
    )
    for event in events:
        writer.writerow(
            [
                event.created_at.isoformat(),
                str(event.site_id),
                event.method.value.lower(),
                event.result.value.lower(),
                event.reason or "",
                str(event.portal_session_id) if event.portal_session_id else "",
                str(event.guest_identity_id) if event.guest_identity_id else "",
            ]
        )
    output.seek(0)
    headers = {"Content-Disposition": "attachment; filename=auth-events.csv"}
    return StreamingResponse(output, media_type="text/csv", headers=headers)


def _build_dashboard_summary(
    db: Session,
    *,
    tenant_ids: list[uuid.UUID],
    period_days: int,
    site_id: uuid.UUID | None,
    site_options: dict[uuid.UUID, str],
) -> DashboardSummaryResponse:
    now = datetime.now(timezone.utc)
    window_start_date = (now - timedelta(days=period_days - 1)).date()
    window_start = datetime.combine(window_start_date, datetime.min.time(), tzinfo=timezone.utc)

    if site_id is not None and site_id not in site_options:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    method_order = [
        AuthMethod.VOUCHER.value.lower(),
        AuthMethod.EMAIL_OTP.value.lower(),
        AuthMethod.OIDC.value.lower(),
        AuthMethod.TOS_ONLY.value.lower(),
    ]
    method_totals = {method: {"attempts": 0, "success": 0, "fail": 0} for method in method_order}

    day_points: dict[str, dict[str, int | str]] = {}
    for offset in range(period_days):
        day = (window_start_date + timedelta(days=offset)).isoformat()
        day_points[day] = {
            "day": day,
            "sessions_started": 0,
            "sessions_authorized": 0,
            "sessions_failed": 0,
            "auth_attempts": 0,
            "auth_success": 0,
            "auth_fail": 0,
            "voucher_redemptions": 0,
            "tos_clicks": 0,
            "otp_success": 0,
            "oidc_success": 0,
        }

    if tenant_ids:
        portal_sessions_query = select(PortalSession).where(
            PortalSession.tenant_id.in_(tenant_ids),
            PortalSession.created_at >= window_start,
        )
        auth_events_query = select(AuthEvent).where(
            AuthEvent.tenant_id.in_(tenant_ids),
            AuthEvent.created_at >= window_start,
        )
        voucher_redemptions_query = select(VoucherRedemption).where(
            VoucherRedemption.tenant_id.in_(tenant_ids),
            VoucherRedemption.redeemed_at >= window_start,
        )

        if site_id is not None:
            portal_sessions_query = portal_sessions_query.where(PortalSession.site_id == site_id)
            auth_events_query = auth_events_query.where(AuthEvent.site_id == site_id)
            voucher_redemptions_query = voucher_redemptions_query.where(VoucherRedemption.site_id == site_id)

        portal_sessions = db.execute(portal_sessions_query).scalars().all()
        auth_events = db.execute(auth_events_query).scalars().all()
        voucher_redemptions = db.execute(voucher_redemptions_query).scalars().all()
    else:
        portal_sessions = []
        auth_events = []
        voucher_redemptions = []

    site_rollups: dict[uuid.UUID, dict[str, int | str]] = {}

    def get_site_rollup(site_uuid: uuid.UUID) -> dict[str, int | str]:
        rollup = site_rollups.get(site_uuid)
        if rollup is not None:
            return rollup
        rollup = {
            "site_id": str(site_uuid),
            "site_name": site_options.get(site_uuid, str(site_uuid)),
            "sessions_started": 0,
            "auth_attempts": 0,
            "auth_success": 0,
            "voucher_redemptions": 0,
            "tos_clicks": 0,
        }
        site_rollups[site_uuid] = rollup
        return rollup

    auth_success = 0
    auth_fail = 0
    sessions_authorized = 0
    sessions_failed = 0

    for session in portal_sessions:
        day = session.created_at.date().isoformat()
        if day not in day_points:
            continue
        day_points[day]["sessions_started"] += 1
        rollup = get_site_rollup(session.site_id)
        rollup["sessions_started"] = int(rollup["sessions_started"]) + 1

        if session.status in {PortalSessionStatus.AUTHORIZED, PortalSessionStatus.AUTHED}:
            day_points[day]["sessions_authorized"] += 1
            sessions_authorized += 1
        elif session.status == PortalSessionStatus.FAILED:
            day_points[day]["sessions_failed"] += 1
            sessions_failed += 1

    for event in auth_events:
        day = event.created_at.date().isoformat()
        if day not in day_points:
            continue
        day_points[day]["auth_attempts"] += 1
        method = event.method.value.lower()
        result = event.result.value.lower()
        method_stats = method_totals.setdefault(method, {"attempts": 0, "success": 0, "fail": 0})
        method_stats["attempts"] += 1

        rollup = get_site_rollup(event.site_id)
        rollup["auth_attempts"] = int(rollup["auth_attempts"]) + 1

        if result == AuthResult.SUCCESS.value.lower():
            day_points[day]["auth_success"] += 1
            method_stats["success"] += 1
            rollup["auth_success"] = int(rollup["auth_success"]) + 1
            auth_success += 1
            if method == AuthMethod.TOS_ONLY.value.lower():
                day_points[day]["tos_clicks"] += 1
                rollup["tos_clicks"] = int(rollup["tos_clicks"]) + 1
            elif method == AuthMethod.EMAIL_OTP.value.lower():
                day_points[day]["otp_success"] += 1
            elif method == AuthMethod.OIDC.value.lower():
                day_points[day]["oidc_success"] += 1
        else:
            day_points[day]["auth_fail"] += 1
            method_stats["fail"] += 1
            auth_fail += 1

    for redemption in voucher_redemptions:
        day = redemption.redeemed_at.date().isoformat()
        if day not in day_points:
            continue
        day_points[day]["voucher_redemptions"] += 1
        rollup = get_site_rollup(redemption.site_id)
        rollup["voucher_redemptions"] = int(rollup["voucher_redemptions"]) + 1

    auth_attempts = len(auth_events)
    success_rate = round((auth_success / auth_attempts) * 100, 2) if auth_attempts else 0.0

    method_payload: list[DashboardMethodBreakdown] = []
    for method in method_order + [key for key in method_totals.keys() if key not in method_order]:
        stats = method_totals[method]
        attempts = stats["attempts"]
        method_payload.append(
            DashboardMethodBreakdown(
                method=method,
                attempts=attempts,
                success=stats["success"],
                fail=stats["fail"],
                success_rate=round((stats["success"] / attempts) * 100, 2) if attempts else 0.0,
            )
        )

    daily_payload = [
        DashboardDailyPoint(**day_points[(window_start_date + timedelta(days=offset)).isoformat()])
        for offset in range(period_days)
    ]

    site_payload = []
    for rollup in site_rollups.values():
        attempts = int(rollup["auth_attempts"])
        success = int(rollup["auth_success"])
        site_payload.append(
            DashboardSiteRollup(
                site_id=str(rollup["site_id"]),
                site_name=str(rollup["site_name"]),
                sessions_started=int(rollup["sessions_started"]),
                auth_attempts=attempts,
                auth_success=success,
                voucher_redemptions=int(rollup["voucher_redemptions"]),
                tos_clicks=int(rollup["tos_clicks"]),
                success_rate=round((success / attempts) * 100, 2) if attempts else 0.0,
            )
        )
    site_payload.sort(
        key=lambda row: (row.auth_success, row.auth_attempts, row.sessions_started),
        reverse=True,
    )

    return DashboardSummaryResponse(
        period_days=period_days,
        site_id=str(site_id) if site_id else None,
        window_start=window_start.isoformat(),
        window_end=now.isoformat(),
        generated_at=now.isoformat(),
        overview=DashboardOverview(
            sessions_started=len(portal_sessions),
            sessions_authorized=sessions_authorized,
            sessions_failed=sessions_failed,
            auth_attempts=auth_attempts,
            auth_success=auth_success,
            auth_fail=auth_fail,
            success_rate=success_rate,
            voucher_redemptions=len(voucher_redemptions),
            tos_clicks=method_totals[AuthMethod.TOS_ONLY.value.lower()]["success"],
        ),
        methods=method_payload,
        daily=daily_payload,
        sites=site_payload,
        site_options=[
            DashboardSiteOption(id=str(site_uuid), display_name=display_name)
            for site_uuid, display_name in sorted(
                site_options.items(),
                key=lambda item: item[1].lower(),
            )
        ],
    )


def _generate_codes(count: int, length: int) -> list[str]:
    alphabet = string.ascii_uppercase + string.digits
    codes: set[str] = set()
    while len(codes) < count:
        code = "".join(secrets.choice(alphabet) for _ in range(length))
        codes.add(code)
    return list(codes)


def _normalize_domains(domains: list[str] | None) -> str | None:
    if not domains:
        return None
    cleaned = []
    for domain in domains:
        value = domain.strip().lower()
        if value:
            cleaned.append(value)
    if not cleaned:
        return None
    unique = sorted(set(cleaned))
    return ",".join(unique)


def _parse_domains(domains: str | None) -> list[str] | None:
    if not domains:
        return None
    values = [value.strip() for value in domains.split(",") if value.strip()]
    return values or None


def _empty_to_none(value: str | None) -> str | None:
    if value == "":
        return None
    return value


def _normalize_success_url(value: str | None) -> str | None:
    normalized = _empty_to_none(value)
    if normalized is None:
        return None
    sanitized = sanitize_redirect_url(normalized, allow_relative=True)
    if sanitized is None:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "INVALID_SUCCESS_URL", "message": "success_url must be http(s) or a relative path."},
            },
        )
    return sanitized


def _resolve_portal_template_mode(
    *,
    mode: str | None,
    enabled: bool | None,
    html: str | None,
    current_mode: str | None = None,
) -> str:
    allowed_modes = {"off", "replace", "embed"}
    if mode is not None:
        normalized_mode = mode.strip().lower()
        if normalized_mode not in allowed_modes:
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {
                        "code": "INVALID_TEMPLATE_MODE",
                        "message": "portal_template_mode must be one of: off, replace, embed.",
                    },
                },
            )
        return normalized_mode
    if enabled is not None:
        if not enabled:
            return "off"
        if html and "{{portal}}" in html:
            return "embed"
        return "replace"
    if current_mode:
        normalized_current = current_mode.strip().lower()
        if normalized_current in allowed_modes:
            return normalized_current
    return "off"


def _normalize_portal_template_theme(theme: object | None) -> dict | None:
    if theme is None:
        return None
    if hasattr(theme, "model_dump"):
        theme = getattr(theme, "model_dump")(exclude_none=True)
    if not isinstance(theme, dict):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "INVALID_TEMPLATE_THEME", "message": "portal_template_theme must be an object."},
            },
        )

    normalized: dict[str, str | int] = {}

    def _normalize_int(
        key: str,
        *,
        minimum: int,
        maximum: int,
    ) -> None:
        raw_value = theme.get(key)
        if raw_value in (None, ""):
            return
        try:
            parsed = int(raw_value)
        except (TypeError, ValueError) as exc:
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {
                        "code": "INVALID_TEMPLATE_THEME",
                        "message": f"{key} must be an integer.",
                    },
                },
            ) from exc
        if parsed < minimum or parsed > maximum:
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {
                        "code": "INVALID_TEMPLATE_THEME",
                        "message": f"{key} must be between {minimum} and {maximum}.",
                    },
                },
            )
        normalized[key] = parsed

    def _normalize_enum(key: str, allowed: set[str]) -> None:
        raw_value = theme.get(key)
        if raw_value in (None, ""):
            return
        if not isinstance(raw_value, str):
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {"code": "INVALID_TEMPLATE_THEME", "message": f"{key} must be a string."},
                },
            )
        value = raw_value.strip().lower()
        if value not in allowed:
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {
                        "code": "INVALID_TEMPLATE_THEME",
                        "message": f"{key} must be one of: {', '.join(sorted(allowed))}.",
                    },
                },
            )
        normalized[key] = value

    def _normalize_color(key: str) -> None:
        raw_value = theme.get(key)
        if raw_value in (None, ""):
            return
        if not isinstance(raw_value, str):
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {"code": "INVALID_TEMPLATE_THEME", "message": f"{key} must be a string."},
                },
            )
        value = raw_value.strip()
        if not re.fullmatch(r"#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})", value):
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {
                        "code": "INVALID_TEMPLATE_THEME",
                        "message": f"{key} must be a hex color like #1F6FEB.",
                    },
                },
            )
        normalized[key] = value

    _normalize_enum("card_alignment", {"left", "center", "right"})
    _normalize_int("card_max_width_px", minimum=320, maximum=1024)
    _normalize_int("logo_size_px", minimum=24, maximum=240)
    _normalize_enum("logo_alignment", {"left", "center", "right"})
    _normalize_int("heading_size_px", minimum=18, maximum=56)
    _normalize_int("body_size_px", minimum=12, maximum=24)
    _normalize_color("background_color")
    _normalize_color("card_background_color")
    _normalize_color("text_color")

    return normalized or None


def _validate_portal_template(mode: str, html: str | None) -> None:
    if mode in {"replace", "embed"} and not html:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "TEMPLATE_REQUIRED",
                    "message": "portal_template_html is required when portal_template_mode is replace or embed.",
                },
            },
        )
    if mode == "embed" and html and "{{portal}}" not in html:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "TEMPLATE_TOKEN_REQUIRED",
                    "message": "Embed mode requires the {{portal}} token in portal_template_html.",
                },
            },
        )


def _normalize_secret_value(value: str | None) -> str | None:
    if value is None:
        return None
    if value.strip() == "":
        return ""
    return value


def _build_tenant_response(tenant: Tenant) -> dict:
    return TenantResponse(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        status=tenant.status.value,
        unifi_base_url=tenant.unifi_base_url,
        unifi_api_key_ref=tenant.unifi_api_key_ref,
        unifi_api_key_stored=bool(tenant.unifi_api_key_encrypted),
    ).model_dump(mode="json")


def _slugify(value: str | None) -> str | None:
    if not value:
        return None
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or None


def _resolve_unifi_credentials(site: Site, tenant: Tenant) -> tuple[str, str]:
    base_url = _empty_to_none(site.unifi_base_url) or tenant.unifi_base_url
    api_key_ref = _empty_to_none(site.unifi_api_key_ref) or tenant.unifi_api_key_ref
    api_key_encrypted = site.unifi_api_key_encrypted or tenant.unifi_api_key_encrypted
    if not base_url or not (api_key_ref or api_key_encrypted):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )
    try:
        api_key = resolve_secret_value(
            encrypted=api_key_encrypted,
            ref=api_key_ref,
            missing_code="UNIFI_CONFIG_REQUIRED",
            missing_message="UniFi controller settings are required.",
        )
    except SecretError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    return base_url, api_key


def _site_response(site: Site) -> SiteResponse:
    template_mode = site.portal_template_mode or (
        "embed"
        if site.portal_template_enabled and site.portal_template_html and "{{portal}}" in site.portal_template_html
        else "replace"
        if site.portal_template_enabled
        else "off"
    )
    return SiteResponse(
        id=str(site.id),
        slug=site.slug,
        display_name=site.display_name,
        enabled=site.enabled,
        logo_url=site.logo_url,
        primary_color=site.primary_color,
        terms_html=sanitize_guest_html(site.terms_html),
        portal_template_html=sanitize_guest_html(site.portal_template_html),
        portal_template_enabled=template_mode != "off",
        portal_template_mode=template_mode,
        portal_template_theme=site.portal_template_theme,
        support_contact=site.support_contact,
        success_url=sanitize_redirect_url(site.success_url, allow_relative=True),
        enable_tos_only=site.enable_tos_only,
        unifi_base_url=site.unifi_base_url,
        unifi_site_id=site.unifi_site_id,
        unifi_api_key_ref=site.unifi_api_key_ref,
        unifi_api_key_stored=bool(site.unifi_api_key_encrypted),
        default_time_limit_minutes=site.default_time_limit_minutes,
        default_data_limit_mb=site.default_data_limit_mb,
        default_rx_kbps=site.default_rx_kbps,
        default_tx_kbps=site.default_tx_kbps,
    )


def _portal_template_state(site: Site) -> tuple[str, str | None, str]:
    return (
        site.portal_template_mode or "off",
        site.portal_template_html,
        json.dumps(site.portal_template_theme or {}, sort_keys=True),
    )


def _snapshot_site_portal_template(
    db: Session,
    *,
    site: Site,
    created_by_admin_user_id: uuid.UUID | None,
) -> None:
    mode = (site.portal_template_mode or "off").strip().lower()
    html = site.portal_template_html
    theme = site.portal_template_theme
    if mode == "off" and not html and not theme:
        return
    db.add(
        SitePortalTemplateVersion(
            tenant_id=site.tenant_id,
            site_id=site.id,
            portal_template_mode=mode,
            portal_template_html=html,
            portal_template_theme=theme,
            created_by_admin_user_id=created_by_admin_user_id,
        )
    )


def _parse_auth_method(value: str | None) -> AuthMethod | None:
    if not value:
        return None
    normalized = value.strip().upper()
    if not normalized:
        return None
    try:
        return AuthMethod(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": "INVALID_METHOD", "message": "Invalid auth method."}},
        ) from exc


def _parse_auth_result(value: str | None) -> AuthResult | None:
    if not value:
        return None
    normalized = value.strip().upper()
    if not normalized:
        return None
    try:
        return AuthResult(normalized)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": "INVALID_RESULT", "message": "Invalid auth result."}},
        ) from exc


def _validate_dashboard_days(days: int) -> int:
    if days < 1 or days > 90:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "INVALID_RANGE", "message": "days must be between 1 and 90."},
            },
        )
    return days


def _validate_pagination(*, limit: int, offset: int) -> tuple[int, int]:
    if limit < 1 or limit > MAX_PAGE_LIMIT:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "INVALID_PAGINATION",
                    "message": f"limit must be between 1 and {MAX_PAGE_LIMIT}.",
                },
            },
        )
    if offset < 0:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "INVALID_PAGINATION", "message": "offset must be 0 or greater."},
            },
        )
    return limit, offset


def _require_site_in_tenant(db: Session, *, tenant_id: uuid.UUID, site_id: uuid.UUID) -> None:
    site_exists = db.execute(
        select(Site.id).where(Site.id == site_id, Site.tenant_id == tenant_id)
    ).scalar_one_or_none()
    if site_exists is None:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )


def _resolve_accessible_tenants(
    db: Session,
    admin_user: AdminUser,
) -> tuple[list[uuid.UUID], dict[uuid.UUID, str]]:
    if admin_user.is_superadmin:
        rows = db.execute(select(Tenant.id, Tenant.name)).all()
    else:
        membership_tenant_ids = sorted({membership.tenant_id for membership in admin_user.memberships})
        if not membership_tenant_ids:
            rows = []
        else:
            rows = db.execute(
                select(Tenant.id, Tenant.name).where(Tenant.id.in_(membership_tenant_ids))
            ).all()
    tenant_ids = [row.id for row in rows]
    tenant_names = {row.id: row.name for row in rows}
    return tenant_ids, tenant_names


def _build_site_options_for_tenants(
    db: Session,
    *,
    tenant_ids: list[uuid.UUID],
    tenant_names: dict[uuid.UUID, str],
) -> dict[uuid.UUID, str]:
    if not tenant_ids:
        return {}
    rows = db.execute(
        select(Site.id, Site.display_name, Site.tenant_id).where(Site.tenant_id.in_(tenant_ids))
    ).all()
    multi_tenant_scope = len(tenant_ids) > 1
    site_options: dict[uuid.UUID, str] = {}
    for row in rows:
        if multi_tenant_scope:
            tenant_label = tenant_names.get(row.tenant_id, str(row.tenant_id))
            site_options[row.id] = f"{tenant_label} / {row.display_name}"
        else:
            site_options[row.id] = row.display_name
    return site_options


def _build_method_daily_report(
    db: Session,
    *,
    tenant_ids: list[uuid.UUID],
    period_days: int,
    site_id: uuid.UUID | None,
    method: AuthMethod | None,
) -> MethodDailyTrendResponse:
    now = datetime.now(timezone.utc)
    window_start_date = (now - timedelta(days=period_days - 1)).date()
    window_start = datetime.combine(window_start_date, datetime.min.time(), tzinfo=timezone.utc)

    if tenant_ids:
        events_query = select(AuthEvent).where(
            AuthEvent.tenant_id.in_(tenant_ids),
            AuthEvent.created_at >= window_start,
        )
        if site_id is not None:
            events_query = events_query.where(AuthEvent.site_id == site_id)
        if method is not None:
            events_query = events_query.where(AuthEvent.method == method)
        events = db.execute(events_query).scalars().all()
    else:
        events = []

    method_keys = (
        [method.value.lower()]
        if method is not None
        else [member.value.lower() for member in AuthMethod]
    )
    rows_by_key: dict[tuple[str, str], dict[str, int]] = {}
    for offset in range(period_days):
        day = (window_start_date + timedelta(days=offset)).isoformat()
        for method_key in method_keys:
            rows_by_key[(day, method_key)] = {"attempts": 0, "success": 0, "fail": 0}

    for event in events:
        day = event.created_at.date().isoformat()
        method_key = event.method.value.lower()
        key = (day, method_key)
        if key not in rows_by_key:
            continue
        rows_by_key[key]["attempts"] += 1
        if event.result == AuthResult.SUCCESS:
            rows_by_key[key]["success"] += 1
        else:
            rows_by_key[key]["fail"] += 1

    rows: list[MethodDailyTrendRow] = []
    for offset in range(period_days):
        day = (window_start_date + timedelta(days=offset)).isoformat()
        for method_key in method_keys:
            values = rows_by_key[(day, method_key)]
            attempts = values["attempts"]
            rows.append(
                MethodDailyTrendRow(
                    day=day,
                    method=method_key,
                    attempts=attempts,
                    success=values["success"],
                    fail=values["fail"],
                    success_rate=round((values["success"] / attempts) * 100, 2) if attempts else 0.0,
                )
            )

    return MethodDailyTrendResponse(
        period_days=period_days,
        site_id=str(site_id) if site_id else None,
        method=method.value.lower() if method else None,
        window_start=window_start.isoformat(),
        window_end=now.isoformat(),
        generated_at=now.isoformat(),
        rows=rows,
    )


def _build_site_comparison_report(
    db: Session,
    *,
    tenant_ids: list[uuid.UUID],
    period_days: int,
    site_id: uuid.UUID | None,
    method: AuthMethod | None,
    site_options: dict[uuid.UUID, str],
) -> SiteComparisonResponse:
    now = datetime.now(timezone.utc)
    window_start_date = (now - timedelta(days=period_days - 1)).date()
    window_start = datetime.combine(window_start_date, datetime.min.time(), tzinfo=timezone.utc)

    if tenant_ids:
        events_query = select(AuthEvent).where(
            AuthEvent.tenant_id.in_(tenant_ids),
            AuthEvent.created_at >= window_start,
        )
        redemptions_query = select(VoucherRedemption).where(
            VoucherRedemption.tenant_id.in_(tenant_ids),
            VoucherRedemption.redeemed_at >= window_start,
        )
        if site_id is not None:
            events_query = events_query.where(AuthEvent.site_id == site_id)
            redemptions_query = redemptions_query.where(VoucherRedemption.site_id == site_id)
        if method is not None:
            events_query = events_query.where(AuthEvent.method == method)

        events = db.execute(events_query).scalars().all()
        redemptions = db.execute(redemptions_query).scalars().all()
    else:
        events = []
        redemptions = []

    if site_id is not None:
        target_ids = [site_id]
    else:
        target_ids = sorted(site_options.keys(), key=lambda candidate: site_options[candidate].lower())

    rows_by_site: dict[uuid.UUID, dict[str, int | str]] = {
        candidate: {
            "site_name": site_options.get(candidate, str(candidate)),
            "auth_attempts": 0,
            "auth_success": 0,
            "auth_fail": 0,
            "voucher_redemptions": 0,
            "tos_clicks": 0,
        }
        for candidate in target_ids
    }

    for event in events:
        bucket = rows_by_site.setdefault(
            event.site_id,
            {
                "site_name": site_options.get(event.site_id, str(event.site_id)),
                "auth_attempts": 0,
                "auth_success": 0,
                "auth_fail": 0,
                "voucher_redemptions": 0,
                "tos_clicks": 0,
            },
        )
        bucket["auth_attempts"] = int(bucket["auth_attempts"]) + 1
        if event.result == AuthResult.SUCCESS:
            bucket["auth_success"] = int(bucket["auth_success"]) + 1
            if event.method == AuthMethod.TOS_ONLY:
                bucket["tos_clicks"] = int(bucket["tos_clicks"]) + 1
        else:
            bucket["auth_fail"] = int(bucket["auth_fail"]) + 1

    for redemption in redemptions:
        bucket = rows_by_site.setdefault(
            redemption.site_id,
            {
                "site_name": site_options.get(redemption.site_id, str(redemption.site_id)),
                "auth_attempts": 0,
                "auth_success": 0,
                "auth_fail": 0,
                "voucher_redemptions": 0,
                "tos_clicks": 0,
            },
        )
        bucket["voucher_redemptions"] = int(bucket["voucher_redemptions"]) + 1

    rows = []
    for candidate, bucket in rows_by_site.items():
        attempts = int(bucket["auth_attempts"])
        success = int(bucket["auth_success"])
        rows.append(
            SiteComparisonRow(
                site_id=str(candidate),
                site_name=str(bucket["site_name"]),
                auth_attempts=attempts,
                auth_success=success,
                auth_fail=int(bucket["auth_fail"]),
                success_rate=round((success / attempts) * 100, 2) if attempts else 0.0,
                voucher_redemptions=int(bucket["voucher_redemptions"]),
                tos_clicks=int(bucket["tos_clicks"]),
            )
        )
    rows.sort(
        key=lambda row: (row.auth_success, row.auth_attempts, row.voucher_redemptions, row.site_name.lower()),
        reverse=True,
    )

    return SiteComparisonResponse(
        period_days=period_days,
        site_id=str(site_id) if site_id else None,
        method=method.value.lower() if method else None,
        window_start=window_start.isoformat(),
        window_end=now.isoformat(),
        generated_at=now.isoformat(),
        rows=rows,
    )


def _serialize_auth_event(event: AuthEvent) -> dict[str, str | None]:
    return {
        "id": str(event.id),
        "site_id": str(event.site_id),
        "method": event.method.value.lower(),
        "result": event.result.value.lower(),
        "reason": event.reason,
        "portal_session_id": str(event.portal_session_id) if event.portal_session_id else None,
        "guest_identity_id": str(event.guest_identity_id) if event.guest_identity_id else None,
        "created_at": event.created_at.isoformat(),
    }


def _auth_events_query(
    tenant_ids: list[uuid.UUID],
    method: str | None,
    result: str | None,
    search: str | None,
    site_id: uuid.UUID | None,
):
    if not tenant_ids:
        return select(AuthEvent).where(false()).order_by(AuthEvent.created_at.desc())
    query = select(AuthEvent).where(AuthEvent.tenant_id.in_(tenant_ids))
    parsed_method = _parse_auth_method(method)
    parsed_result = _parse_auth_result(result)
    if parsed_method is not None:
        query = query.where(AuthEvent.method == parsed_method)
    if parsed_result is not None:
        query = query.where(AuthEvent.result == parsed_result)
    if site_id is not None:
        query = query.where(AuthEvent.site_id == site_id)
    if search:
        trimmed = search.strip()
        if trimmed:
            try:
                search_uuid = uuid.UUID(trimmed)
            except ValueError:
                search_uuid = None
            if search_uuid:
                query = query.where(
                    or_(
                        AuthEvent.portal_session_id == search_uuid,
                        AuthEvent.guest_identity_id == search_uuid,
                    )
                )
            else:
                like = f"%{trimmed.lower()}%"
                query = query.join(
                    GuestIdentity,
                    GuestIdentity.id == AuthEvent.guest_identity_id,
                    isouter=True,
                ).where(
                    or_(
                        func.lower(GuestIdentity.email).like(like),
                        func.lower(GuestIdentity.display_name).like(like),
                        func.lower(AuthEvent.reason).like(like),
                    )
                )
    return query.order_by(AuthEvent.created_at.desc())
