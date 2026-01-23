from __future__ import annotations

import csv
import io
import logging
import re
import secrets
import string
import time
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, or_, select
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
    Site,
    SiteOidcSetting,
    Tenant,
    TenantOpenvpnClientProfile,
    TenantOpenvpnSecret,
    TenantStatus,
    Voucher,
    VoucherBatch,
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
    SiteCreateRequest,
    SiteProvisionRequest,
    SiteResponse,
    SiteUpdateRequest,
    UnifiSiteDiscoveryResponse,
)
from app.schemas.admin_tenant import (
    OpenvpnGenerateRequest,
    TenantCreateRequest,
    TenantResponse,
    TenantUpdateRequest,
)
from app.schemas.admin_voucher import VoucherBatchCreateRequest
from app.security import create_session_token, hash_password, verify_password
from app.services.openvpn import (
    OpenVpnError,
    decrypt_openvpn_secret,
    encrypt_openvpn_secret,
    generate_openvpn_auth_credentials,
    generate_openvpn_client_profile,
    profile_requires_remote_settings,
    resolve_openvpn_profile_template,
)
from app.services.unifi import UnifiApiError, UnifiClient
from app.settings import settings

router = APIRouter()
logger = logging.getLogger(__name__)

@router.post("/login")
def login(payload: AdminLoginRequest, db: Session = Depends(get_db)) -> JSONResponse:
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

    openvpn_profile_template = _empty_to_none(payload.openvpn_profile_template)
    openvpn_ca_bundle = _empty_to_none(payload.openvpn_ca_bundle)
    openvpn_auth_blob = _empty_to_none(payload.openvpn_auth_blob)

    tenant = Tenant(
        id=uuid.uuid4(),
        slug=normalized_slug,
        name=payload.name,
        status=status,
        unifi_base_url=_empty_to_none(payload.unifi_base_url),
        unifi_api_key_ref=_empty_to_none(payload.unifi_api_key_ref),
        is_roaming=payload.is_roaming or False,
        openvpn_enabled=payload.openvpn_enabled or False,
        openvpn_profile_ref=_empty_to_none(payload.openvpn_profile_ref),
        openvpn_auth_ref=_empty_to_none(payload.openvpn_auth_ref),
        openvpn_ca_ref=_empty_to_none(payload.openvpn_ca_ref),
        openvpn_remote_host=_empty_to_none(payload.openvpn_remote_host),
        openvpn_remote_port=_validate_openvpn_port(payload.openvpn_remote_port),
    )
    _validate_openvpn_requirements(
        is_roaming=tenant.is_roaming,
        openvpn_enabled=tenant.openvpn_enabled,
        openvpn_profile_ref=tenant.openvpn_profile_ref,
        openvpn_profile_template=openvpn_profile_template,
        openvpn_secret=None,
        openvpn_remote_host=tenant.openvpn_remote_host,
        openvpn_remote_port=tenant.openvpn_remote_port,
    )
    if openvpn_profile_template is None and (openvpn_ca_bundle or openvpn_auth_blob):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "OPENVPN_PROFILE_REQUIRED",
                    "message": "OpenVPN profile template is required to store CA or auth content.",
                },
            },
        )
    db.add(tenant)
    if openvpn_profile_template:
        _apply_openvpn_secret_updates(
            db=db,
            tenant=tenant,
            profile_template=openvpn_profile_template,
            ca_bundle=openvpn_ca_bundle,
            auth_blob=openvpn_auth_blob,
        )
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
    if payload.is_roaming is not None:
        tenant.is_roaming = payload.is_roaming
    if payload.openvpn_enabled is not None:
        tenant.openvpn_enabled = payload.openvpn_enabled
    if payload.openvpn_profile_ref is not None:
        tenant.openvpn_profile_ref = _empty_to_none(payload.openvpn_profile_ref)
    if payload.openvpn_auth_ref is not None:
        tenant.openvpn_auth_ref = _empty_to_none(payload.openvpn_auth_ref)
    if payload.openvpn_ca_ref is not None:
        tenant.openvpn_ca_ref = _empty_to_none(payload.openvpn_ca_ref)
    if payload.openvpn_remote_host is not None:
        tenant.openvpn_remote_host = _empty_to_none(payload.openvpn_remote_host)
    if payload.openvpn_remote_port is not None:
        tenant.openvpn_remote_port = _validate_openvpn_port(payload.openvpn_remote_port)

    openvpn_profile_template = _normalize_secret_value(payload.openvpn_profile_template)
    openvpn_ca_bundle = _normalize_secret_value(payload.openvpn_ca_bundle)
    openvpn_auth_blob = _normalize_secret_value(payload.openvpn_auth_blob)
    openvpn_secret_for_validation = tenant.openvpn_secret
    if openvpn_profile_template == "":
        openvpn_secret_for_validation = None

    _validate_openvpn_requirements(
        is_roaming=tenant.is_roaming,
        openvpn_enabled=tenant.openvpn_enabled,
        openvpn_profile_ref=tenant.openvpn_profile_ref,
        openvpn_profile_template=openvpn_profile_template if openvpn_profile_template not in ("", None) else None,
        openvpn_secret=openvpn_secret_for_validation,
        openvpn_remote_host=tenant.openvpn_remote_host,
        openvpn_remote_port=tenant.openvpn_remote_port,
    )

    if (
        openvpn_profile_template is None
        and (openvpn_ca_bundle is not None or openvpn_auth_blob is not None)
        and tenant.openvpn_secret is None
        and openvpn_secret_for_validation is None
    ):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "OPENVPN_PROFILE_REQUIRED",
                    "message": "OpenVPN profile template is required to store CA or auth content.",
                },
            },
        )

    db.add(tenant)
    _apply_openvpn_secret_updates(
        db=db,
        tenant=tenant,
        profile_template=openvpn_profile_template,
        ca_bundle=openvpn_ca_bundle,
        auth_blob=openvpn_auth_blob,
    )
    db.commit()
    db.refresh(tenant)
    return {
        "ok": True,
        "data": {
            "tenant": _build_tenant_response(tenant)
        },
    }


@router.get("/tenants/{tenant_id}/openvpn/profile")
def download_openvpn_profile(
    tenant_id: uuid.UUID,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> Response:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    if not tenant.openvpn_enabled:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "OPENVPN_NOT_CONFIGURED",
                    "message": "OpenVPN generation is not configured for this tenant.",
                },
            },
        )
    profile_record = (
        db.execute(
            select(TenantOpenvpnClientProfile)
            .where(TenantOpenvpnClientProfile.tenant_id == tenant_id)
            .order_by(TenantOpenvpnClientProfile.created_at.desc())
        )
        .scalars()
        .first()
    )
    if not profile_record:
        raise HTTPException(
            status_code=404,
            detail={
                "ok": False,
                "error": {
                    "code": "OPENVPN_PROFILE_NOT_GENERATED",
                    "message": "Generate an OpenVPN profile before downloading.",
                },
            },
        )
    try:
        profile = decrypt_openvpn_secret(profile_record.profile_encrypted)
    except OpenVpnError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    filename = f"{profile_record.client_name}.ovpn"
    return Response(
        content=profile,
        media_type="application/x-openvpn-profile",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/tenants/{tenant_id}/openvpn/generate")
def generate_openvpn_profile(
    tenant_id: uuid.UUID,
    payload: OpenvpnGenerateRequest,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )
    if not tenant.openvpn_remote_host or not tenant.openvpn_remote_port:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "OPENVPN_NOT_CONFIGURED",
                    "message": "OpenVPN remote host and port are required for generation.",
                },
            },
        )
    try:
        profile = generate_openvpn_client_profile(payload.client_name)
        encrypted_profile = encrypt_openvpn_secret(profile)
    except OpenVpnError as exc:
        logger.error(f"OpenVPN generation error: {exc.code} - {str(exc)}")
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    except Exception as exc:
        logger.error(f"Unexpected error during OpenVPN generation: {exc}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"ok": False, "error": {"code": "OPENVPN_GENERATION_FAILED", "message": "Failed to generate OpenVPN profile."}},
        ) from exc

    profile_record = TenantOpenvpnClientProfile(
        tenant_id=tenant.id,
        client_name=payload.client_name.strip(),
        profile_encrypted=encrypted_profile,
    )

    auth_username: str | None = None
    auth_password: str | None = None
    auth_blob: str | None = None
    if tenant.openvpn_secret and tenant.openvpn_secret.auth_blob_encrypted:
        try:
            auth_blob = decrypt_openvpn_secret(tenant.openvpn_secret.auth_blob_encrypted)
        except OpenVpnError:
            auth_blob = None

    if auth_blob:
        lines = [line for line in auth_blob.splitlines() if line.strip()]
        if len(lines) >= 2:
            auth_username, auth_password = lines[0], lines[1]
    else:
        auth_username, auth_password = generate_openvpn_auth_credentials()
        auth_blob = f"{auth_username}\n{auth_password}"
        encrypted_auth = encrypt_openvpn_secret(auth_blob)
        if tenant.openvpn_secret:
            tenant.openvpn_secret.auth_blob_encrypted = encrypted_auth
        else:
            profile_template = resolve_openvpn_profile_template(
                openvpn_profile_template=None,
                openvpn_profile_ref=tenant.openvpn_profile_ref,
                openvpn_secret=None,
            )
            if not profile_template:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "ok": False,
                        "error": {
                            "code": "OPENVPN_PROFILE_MISSING",
                            "message": "OpenVPN profile template is required.",
                        },
                    },
                )
            tenant.openvpn_secret = TenantOpenvpnSecret(
                tenant_id=tenant.id,
                profile_template_encrypted=encrypt_openvpn_secret(profile_template),
                auth_blob_encrypted=encrypted_auth,
            )
            db.add(tenant.openvpn_secret)

    db.add(profile_record)
    db.commit()
    db.refresh(profile_record)

    return {
        "ok": True,
        "data": {
            "client": {
                "id": str(profile_record.id),
                "client_name": profile_record.client_name,
                "created_at": profile_record.created_at,
            },
            "auth_username": auth_username,
            "auth_password": auth_password,
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
    if not tenant.unifi_base_url or not tenant.unifi_api_key_ref:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )
    client = UnifiClient(
        tenant.unifi_base_url,
        tenant.unifi_api_key_ref,
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
    if not tenant.unifi_base_url or not tenant.unifi_api_key_ref:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )

    client = UnifiClient(
        tenant.unifi_base_url,
        tenant.unifi_api_key_ref,
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
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_ADMIN])),
) -> dict:
    tenant = db.execute(select(Tenant).where(Tenant.id == tenant_id)).scalar_one_or_none()
    if not tenant:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Tenant not found."}},
        )

    base_url = _empty_to_none(payload.unifi_base_url) or tenant.unifi_base_url
    api_key_ref = _empty_to_none(payload.unifi_api_key_ref) or tenant.unifi_api_key_ref
    if not base_url or not api_key_ref:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )

    site = Site(
        tenant_id=tenant_id,
        slug=payload.slug,
        display_name=payload.display_name,
        enabled=payload.enabled,
        logo_url=_empty_to_none(payload.logo_url),
        primary_color=_empty_to_none(payload.primary_color),
        terms_html=_empty_to_none(payload.terms_html),
        portal_template_html=_empty_to_none(payload.portal_template_html),
        portal_template_enabled=payload.portal_template_enabled,
        support_contact=_empty_to_none(payload.support_contact),
        success_url=_empty_to_none(payload.success_url),
        enable_tos_only=payload.enable_tos_only,
        unifi_base_url=_empty_to_none(payload.unifi_base_url),
        unifi_site_id=payload.unifi_site_id.strip(),
        unifi_api_key_ref=_empty_to_none(payload.unifi_api_key_ref),
        default_time_limit_minutes=payload.default_time_limit_minutes,
        default_data_limit_mb=payload.default_data_limit_mb,
        default_rx_kbps=payload.default_rx_kbps,
        default_tx_kbps=payload.default_tx_kbps,
    )
    db.add(site)
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


@router.put("/tenants/{tenant_id}/sites/{site_id}")
def update_site(
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
    payload: SiteUpdateRequest,
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
        site.terms_html = _empty_to_none(payload.terms_html)
    if payload.portal_template_html is not None:
        site.portal_template_html = _empty_to_none(payload.portal_template_html)
    if payload.portal_template_enabled is not None:
        site.portal_template_enabled = payload.portal_template_enabled
    if payload.support_contact is not None:
        site.support_contact = _empty_to_none(payload.support_contact)
    if payload.success_url is not None:
        site.success_url = _empty_to_none(payload.success_url)
    if payload.enable_tos_only is not None:
        site.enable_tos_only = payload.enable_tos_only
    if payload.unifi_base_url is not None:
        site.unifi_base_url = _empty_to_none(payload.unifi_base_url)
    if payload.unifi_site_id is not None:
        site.unifi_site_id = _empty_to_none(payload.unifi_site_id) or site.unifi_site_id
    if payload.unifi_api_key_ref is not None:
        site.unifi_api_key_ref = _empty_to_none(payload.unifi_api_key_ref)
    if payload.default_time_limit_minutes is not None:
        site.default_time_limit_minutes = payload.default_time_limit_minutes
    if payload.default_data_limit_mb is not None:
        site.default_data_limit_mb = payload.default_data_limit_mb
    if payload.default_rx_kbps is not None:
        site.default_rx_kbps = payload.default_rx_kbps
    if payload.default_tx_kbps is not None:
        site.default_tx_kbps = payload.default_tx_kbps

    if not (site.unifi_base_url or tenant.unifi_base_url) or not (site.unifi_api_key_ref or tenant.unifi_api_key_ref):
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )

    db.add(site)
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

    base_url, api_key_ref = _resolve_unifi_credentials(site, tenant)

    start = time.monotonic()
    client = UnifiClient(
        base_url,
        api_key_ref,
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
    provider = OidcProvider(
        tenant_id=tenant_id,
        issuer=payload.issuer,
        client_id=payload.client_id,
        client_secret_ref=payload.client_secret_ref,
        scopes=payload.scopes,
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
        provider.client_secret_ref = payload.client_secret_ref
    if payload.scopes is not None:
        provider.scopes = payload.scopes
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
    vouchers = [Voucher(batch_id=batch.id, code=code) for code in codes]
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
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> dict:
    query = _auth_events_query(tenant_id, method, result, search)
    events = db.execute(query).scalars().all()
    payload = [
        {
            "id": str(event.id),
            "site_id": str(event.site_id),
            "method": event.method.value.lower(),
            "result": event.result.value.lower(),
            "reason": event.reason,
            "portal_session_id": str(event.portal_session_id) if event.portal_session_id else None,
            "guest_identity_id": str(event.guest_identity_id) if event.guest_identity_id else None,
            "created_at": event.created_at.isoformat(),
        }
        for event in events
    ]
    return {"ok": True, "data": {"events": payload}}


@router.get("/tenants/{tenant_id}/auth-events/export.csv")
def export_auth_events(
    tenant_id: uuid.UUID,
    method: str | None = None,
    result: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
    _admin: AdminUser = Depends(require_tenant_role([AdminRole.TENANT_VIEWER, AdminRole.TENANT_ADMIN])),
) -> StreamingResponse:
    query = _auth_events_query(tenant_id, method, result, search)
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


def _normalize_secret_value(value: str | None) -> str | None:
    if value is None:
        return None
    if value.strip() == "":
        return ""
    return value


def _build_tenant_response(tenant: Tenant) -> dict:
    secret = tenant.openvpn_secret
    latest_profile = tenant.openvpn_client_profiles[0] if tenant.openvpn_client_profiles else None
    return TenantResponse(
        id=str(tenant.id),
        name=tenant.name,
        slug=tenant.slug,
        status=tenant.status.value,
        unifi_base_url=tenant.unifi_base_url,
        unifi_api_key_ref=tenant.unifi_api_key_ref,
        is_roaming=tenant.is_roaming,
        openvpn_enabled=tenant.openvpn_enabled,
        openvpn_profile_ref=tenant.openvpn_profile_ref,
        openvpn_profile_stored=secret is not None,
        openvpn_auth_ref=tenant.openvpn_auth_ref,
        openvpn_auth_stored=bool(secret and secret.auth_blob_encrypted),
        openvpn_ca_ref=tenant.openvpn_ca_ref,
        openvpn_ca_stored=bool(secret and secret.ca_bundle_encrypted),
        openvpn_remote_host=tenant.openvpn_remote_host,
        openvpn_remote_port=tenant.openvpn_remote_port,
        openvpn_generated_client_name=latest_profile.client_name if latest_profile else None,
        openvpn_generated_created_at=latest_profile.created_at if latest_profile else None,
        openvpn_clients=[
            {
                "id": str(profile.id),
                "client_name": profile.client_name,
                "created_at": profile.created_at,
            }
            for profile in tenant.openvpn_client_profiles
        ]
        if tenant.openvpn_client_profiles
        else None,
    ).model_dump(mode="json")


def _apply_openvpn_secret_updates(
    *,
    db: Session,
    tenant: Tenant,
    profile_template: str | None,
    ca_bundle: str | None,
    auth_blob: str | None,
) -> None:
    if profile_template is None and ca_bundle is None and auth_blob is None:
        return

    secret = tenant.openvpn_secret

    if profile_template == "":
        if (ca_bundle not in (None, "")) or (auth_blob not in (None, "")):
            raise HTTPException(
                status_code=400,
                detail={
                    "ok": False,
                    "error": {
                        "code": "OPENVPN_PROFILE_REQUIRED",
                        "message": "OpenVPN profile template is required to store CA or auth content.",
                    },
                },
            )
        if secret is not None:
            db.delete(secret)
            tenant.openvpn_secret = None
        return

    if secret is None:
        if profile_template in (None, ""):
            return
        try:
            secret = TenantOpenvpnSecret(
                tenant_id=tenant.id,
                profile_template_encrypted=encrypt_openvpn_secret(profile_template),
                ca_bundle_encrypted=encrypt_openvpn_secret(ca_bundle) if ca_bundle else None,
                auth_blob_encrypted=encrypt_openvpn_secret(auth_blob) if auth_blob else None,
            )
        except OpenVpnError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
            ) from exc
        tenant.openvpn_secret = secret
        db.add(secret)
        return

    try:
        if profile_template is not None:
            secret.profile_template_encrypted = encrypt_openvpn_secret(profile_template)
        if ca_bundle is not None:
            secret.ca_bundle_encrypted = None if ca_bundle == "" else encrypt_openvpn_secret(ca_bundle)
        if auth_blob is not None:
            secret.auth_blob_encrypted = None if auth_blob == "" else encrypt_openvpn_secret(auth_blob)
    except OpenVpnError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    db.add(secret)


def _validate_openvpn_port(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 1 or value > 65535:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "INVALID_OPENVPN_PORT", "message": "OpenVPN port must be 1-65535."},
            },
        )
    return value


def _validate_openvpn_requirements(
    *,
    is_roaming: bool,
    openvpn_enabled: bool,
    openvpn_profile_ref: str | None,
    openvpn_profile_template: str | None,
    openvpn_secret: TenantOpenvpnSecret | None,
    openvpn_remote_host: str | None,
    openvpn_remote_port: int | None,
) -> None:
    if not (is_roaming or openvpn_enabled):
        return
    missing_fields = []
    profile_template = None
    try:
        profile_template = resolve_openvpn_profile_template(
            openvpn_profile_template=openvpn_profile_template,
            openvpn_profile_ref=openvpn_profile_ref,
            openvpn_secret=openvpn_secret,
        )
    except OpenVpnError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": exc.code, "message": str(exc)}},
        ) from exc
    # profile_template check removed - resolve_openvpn_profile_template now returns default template
    needs_remote_settings = True
    if profile_template is not None:
        needs_remote_settings = profile_requires_remote_settings(profile_template)
    if needs_remote_settings:
        if not openvpn_remote_host:
            missing_fields.append("openvpn_remote_host")
        if not openvpn_remote_port:
            missing_fields.append("openvpn_remote_port")
    if missing_fields:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {
                    "code": "OPENVPN_CONFIG_REQUIRED",
                    "message": f"OpenVPN settings required: {', '.join(missing_fields)}.",
                },
            },
        )


def _slugify(value: str | None) -> str | None:
    if not value:
        return None
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", value.strip().lower()).strip("-")
    return slug or None


def _resolve_unifi_credentials(site: Site, tenant: Tenant) -> tuple[str, str]:
    base_url = _empty_to_none(site.unifi_base_url) or tenant.unifi_base_url
    api_key_ref = _empty_to_none(site.unifi_api_key_ref) or tenant.unifi_api_key_ref
    if not base_url or not api_key_ref:
        raise HTTPException(
            status_code=400,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_REQUIRED", "message": "UniFi controller settings are required."},
            },
        )
    return base_url, api_key_ref


def _site_response(site: Site) -> SiteResponse:
    return SiteResponse(
        id=str(site.id),
        slug=site.slug,
        display_name=site.display_name,
        enabled=site.enabled,
        logo_url=site.logo_url,
        primary_color=site.primary_color,
        terms_html=site.terms_html,
        portal_template_html=site.portal_template_html,
        portal_template_enabled=site.portal_template_enabled,
        support_contact=site.support_contact,
        success_url=site.success_url,
        enable_tos_only=site.enable_tos_only,
        unifi_base_url=site.unifi_base_url,
        unifi_site_id=site.unifi_site_id,
        unifi_api_key_ref=site.unifi_api_key_ref,
        default_time_limit_minutes=site.default_time_limit_minutes,
        default_data_limit_mb=site.default_data_limit_mb,
        default_rx_kbps=site.default_rx_kbps,
        default_tx_kbps=site.default_tx_kbps,
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


def _auth_events_query(
    tenant_id: uuid.UUID,
    method: str | None,
    result: str | None,
    search: str | None,
):
    query = select(AuthEvent).where(AuthEvent.tenant_id == tenant_id)
    parsed_method = _parse_auth_method(method)
    parsed_result = _parse_auth_result(result)
    if parsed_method is not None:
        query = query.where(AuthEvent.method == parsed_method)
    if parsed_result is not None:
        query = query.where(AuthEvent.result == parsed_result)
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
