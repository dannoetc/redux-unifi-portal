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
from app.models import (
    AdminRole,
    AdminUser,
    OidcProvider,
    Site,
    SiteOidcSetting,
    Tenant,
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
from app.schemas.admin_site import SiteResponse, SiteUpdateRequest
from app.schemas.admin_tenant import TenantCreateRequest, TenantResponse
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
                TenantResponse(
                    id=str(tenant.id),
                    name=tenant.name,
                    slug=tenant.slug,
                    status=tenant.status.value,
                ).model_dump(mode="json")
                for tenant in tenants
            ]
        },
    }


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

    tenant = Tenant(
        id=uuid.uuid4(),
        slug=payload.slug,
        name=payload.name,
        status=status,
    )
    db.add(tenant)
    db.commit()
    db.refresh(tenant)
    return {
        "ok": True,
        "data": {
            "tenant": TenantResponse(
                id=str(tenant.id),
                name=tenant.name,
                slug=tenant.slug,
                status=tenant.status.value,
            ).model_dump(mode="json")
        },
    }


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
    if payload.support_contact is not None:
        site.support_contact = _empty_to_none(payload.support_contact)
    if payload.success_url is not None:
        site.success_url = _empty_to_none(payload.success_url)
    if payload.enable_tos_only is not None:
        site.enable_tos_only = payload.enable_tos_only
    if payload.unifi_base_url is not None:
        site.unifi_base_url = _empty_to_none(payload.unifi_base_url) or site.unifi_base_url
    if payload.unifi_site_id is not None:
        site.unifi_site_id = _empty_to_none(payload.unifi_site_id) or site.unifi_site_id
    if payload.unifi_api_key_ref is not None:
        site.unifi_api_key_ref = _empty_to_none(payload.unifi_api_key_ref) or site.unifi_api_key_ref
    if payload.default_time_limit_minutes is not None:
        site.default_time_limit_minutes = payload.default_time_limit_minutes
    if payload.default_data_limit_mb is not None:
        site.default_data_limit_mb = payload.default_data_limit_mb
    if payload.default_rx_kbps is not None:
        site.default_rx_kbps = payload.default_rx_kbps
    if payload.default_tx_kbps is not None:
        site.default_tx_kbps = payload.default_tx_kbps

    db.add(site)
    db.commit()
    db.refresh(site)
    return {"ok": True, "data": {"site": _site_response(site).model_dump(mode="json")}}


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


def _empty_to_none(value: str | None) -> str | None:
    if value == "":
        return None
    return value


def _site_response(site: Site) -> SiteResponse:
    return SiteResponse(
        id=str(site.id),
        slug=site.slug,
        display_name=site.display_name,
        enabled=site.enabled,
        logo_url=site.logo_url,
        primary_color=site.primary_color,
        terms_html=site.terms_html,
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
