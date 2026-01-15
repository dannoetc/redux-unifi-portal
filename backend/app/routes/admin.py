from __future__ import annotations

import csv
import io
import secrets
import string
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import ADMIN_SESSION_COOKIE, get_current_admin, require_tenant_role
from app.models import AdminRole, AdminUser, OidcProvider, Site, SiteOidcSetting, Voucher, VoucherBatch
from app.schemas.admin import AdminLoginRequest
from app.schemas.admin_oidc import (
    OidcProviderCreateRequest,
    OidcProviderResponse,
    OidcProviderUpdateRequest,
    SiteOidcResponse,
    SiteOidcUpdateRequest,
)
from app.schemas.admin_voucher import VoucherBatchCreateRequest
from app.security import create_session_token, verify_password
from app.settings import settings

router = APIRouter()

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
