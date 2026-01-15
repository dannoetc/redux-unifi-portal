from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    AuthEvent,
    AuthMethod,
    AuthResult,
    GuestIdentity,
    PortalSession,
    PortalSessionStatus,
    Site,
    SiteOidcSetting,
    Tenant,
)
from app.schemas.guest import (
    GuestOtpStartRequest,
    GuestOtpVerifyRequest,
    GuestSessionInitRequest,
    GuestVoucherRequest,
)
from app.services.otp import start_challenge, verify_code
from app.services.portal_session import create_or_reuse_session, set_status
from app.services.ratelimit import enforce_rate_limit, limit_key_ip, limit_key_mac
from app.services.unifi import UnifiClient, UnifiPolicy
from app.services.vouchers import VoucherError, redeem_voucher
from app.tasks.otp import send_otp_email
from app.redis import get_redis_client
from app.settings import settings
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter()

@router.get("/{tenant_slug}/{site_slug}/config")
def get_site_config(
    tenant_slug: str,
    site_slug: str,
    db: Session = Depends(get_db),
) -> dict:
    site = _get_site(db, tenant_slug, site_slug)
    if not site.enabled:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    methods = ["voucher", "email_otp"]
    oidc_enabled = db.execute(
        select(SiteOidcSetting.id).where(
            SiteOidcSetting.site_id == site.id, SiteOidcSetting.enabled.is_(True)
        )
    ).scalar_one_or_none()
    if oidc_enabled:
        methods.append("oidc")

    policy = {
        "time_limit_minutes": site.default_time_limit_minutes,
        "data_limit_mb": site.default_data_limit_mb,
        "rx_kbps": site.default_rx_kbps,
        "tx_kbps": site.default_tx_kbps,
    }

    return {
        "ok": True,
        "data": {
            "branding": {
                "logo_url": site.logo_url,
                "primary_color": site.primary_color,
                "terms_html": site.terms_html,
                "support_contact": site.support_contact,
                "display_name": site.display_name,
            },
            "methods": methods,
            "policy": policy,
        },
    }


@router.post("/{tenant_slug}/{site_slug}/session/init")
def init_session(
    tenant_slug: str,
    site_slug: str,
    payload: GuestSessionInitRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    site = _get_site(db, tenant_slug, site_slug)
    if not site.enabled:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    redis_client = get_redis_client()
    user_agent = payload.user_agent or request.headers.get("user-agent")
    client_ip = request.client.host if request.client else None
    session = create_or_reuse_session(
        db,
        redis_client,
        tenant_id=site.tenant_id,
        site=site,
        client_mac=payload.id,
        ap_mac=payload.ap,
        ssid=payload.ssid,
        orig_url=payload.url,
        ip=client_ip,
        user_agent=user_agent,
    )

    methods = ["voucher", "email_otp"]
    oidc_enabled = db.execute(
        select(SiteOidcSetting.id).where(
            SiteOidcSetting.site_id == site.id, SiteOidcSetting.enabled.is_(True)
        )
    ).scalar_one_or_none()
    if oidc_enabled:
        methods.append("oidc")

    return {
        "ok": True,
        "data": {"portal_session_id": str(session.portal_session_id), "methods": methods},
    }


@router.post("/{tenant_slug}/{site_slug}/voucher")
def voucher_auth(
    tenant_slug: str,
    site_slug: str,
    payload: GuestVoucherRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    site = _get_site(db, tenant_slug, site_slug)
    portal_session = _get_portal_session(db, payload.portal_session_id, site)

    redis_client = get_redis_client()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_ip(client_ip, "voucher"),
        limit=settings.VOUCHER_RATE_LIMIT_PER_IP,
        window_seconds=settings.VOUCHER_RATE_LIMIT_WINDOW_SECONDS,
    )
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_mac(str(site.id), portal_session.client_mac, "voucher"),
        limit=settings.VOUCHER_RATE_LIMIT_PER_MAC,
        window_seconds=settings.VOUCHER_RATE_LIMIT_WINDOW_SECONDS,
    )

    try:
        redeem_voucher(
            db,
            site_id=site.id,
            tenant_id=site.tenant_id,
            portal_session_id=portal_session.id,
            code=payload.code,
            client_mac=portal_session.client_mac,
        )
    except VoucherError as exc:
        set_status(db, redis_client, site_id=site.id, client_mac=portal_session.client_mac, status=PortalSessionStatus.FAILED)
        _log_auth_event(
            db,
            site=site,
            portal_session=portal_session,
            method=AuthMethod.VOUCHER,
            result=AuthResult.FAIL,
            reason=str(exc),
        )
        raise HTTPException(
            status_code=409,
            detail={"ok": False, "error": {"code": "VOUCHER_INVALID", "message": "Voucher is not valid."}},
        ) from exc

    authorized, reason, unifi_client_id = _authorize_unifi(site, portal_session.client_mac)
    if not authorized:
        set_status(db, redis_client, site_id=site.id, client_mac=portal_session.client_mac, status=PortalSessionStatus.FAILED)
        _log_auth_event(
            db,
            site=site,
            portal_session=portal_session,
            method=AuthMethod.VOUCHER,
            result=AuthResult.FAIL,
            reason=reason,
            unifi_client_id=unifi_client_id,
        )
        raise HTTPException(
            status_code=502,
            detail={"ok": False, "error": {"code": "UNIFI_ERROR", "message": "Authorization failed."}},
        )

    set_status(db, redis_client, site_id=site.id, client_mac=portal_session.client_mac, status=PortalSessionStatus.AUTHORIZED)
    _log_auth_event(
        db,
        site=site,
        portal_session=portal_session,
        method=AuthMethod.VOUCHER,
        result=AuthResult.SUCCESS,
        unifi_client_id=unifi_client_id,
    )

    return {"ok": True, "data": {"continue_url": _continue_url(portal_session, site)}}


@router.post("/{tenant_slug}/{site_slug}/otp/start")
def otp_start(
    tenant_slug: str,
    site_slug: str,
    payload: GuestOtpStartRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    site = _get_site(db, tenant_slug, site_slug)
    portal_session = _get_portal_session(db, payload.portal_session_id, site)

    redis_client = get_redis_client()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_ip(client_ip, "otp_start"),
        limit=settings.OTP_RATE_LIMIT_PER_IP,
        window_seconds=settings.OTP_RATE_LIMIT_WINDOW_SECONDS,
    )
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_mac(str(site.id), portal_session.client_mac, "otp_start"),
        limit=settings.OTP_RATE_LIMIT_PER_MAC,
        window_seconds=settings.OTP_RATE_LIMIT_WINDOW_SECONDS,
    )

    code = start_challenge(
        redis_client,
        site_id=site.id,
        client_mac=portal_session.client_mac,
        email=payload.email,
    )
    send_otp_email.delay(
        payload.email,
        code,
        {
            "display_name": site.display_name,
            "support_contact": site.support_contact,
        },
    )

    return {"ok": True, "data": {"sent": True}}


@router.post("/{tenant_slug}/{site_slug}/otp/verify")
def otp_verify(
    tenant_slug: str,
    site_slug: str,
    payload: GuestOtpVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    site = _get_site(db, tenant_slug, site_slug)
    portal_session = _get_portal_session(db, payload.portal_session_id, site)

    redis_client = get_redis_client()
    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_ip(client_ip, "otp_verify"),
        limit=settings.OTP_VERIFY_RATE_LIMIT_PER_IP,
        window_seconds=settings.OTP_RATE_LIMIT_WINDOW_SECONDS,
    )
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_mac(str(site.id), portal_session.client_mac, "otp_verify"),
        limit=settings.OTP_VERIFY_RATE_LIMIT_PER_MAC,
        window_seconds=settings.OTP_RATE_LIMIT_WINDOW_SECONDS,
    )

    ok, reason = verify_code(
        redis_client,
        site_id=site.id,
        client_mac=portal_session.client_mac,
        email=payload.email,
        code=payload.code,
    )
    if not ok:
        _log_auth_event(
            db,
            site=site,
            portal_session=portal_session,
            method=AuthMethod.EMAIL_OTP,
            result=AuthResult.FAIL,
            reason=reason,
        )
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": "OTP_INVALID", "message": "Invalid code."}},
        )

    identity = _upsert_guest_identity(db, site.tenant_id, payload.email)
    authorized, auth_reason, unifi_client_id = _authorize_unifi(site, portal_session.client_mac)
    if not authorized:
        set_status(db, redis_client, site_id=site.id, client_mac=portal_session.client_mac, status=PortalSessionStatus.FAILED)
        _log_auth_event(
            db,
            site=site,
            portal_session=portal_session,
            method=AuthMethod.EMAIL_OTP,
            result=AuthResult.FAIL,
            reason=auth_reason,
            unifi_client_id=unifi_client_id,
            guest_identity=identity,
        )
        raise HTTPException(
            status_code=502,
            detail={"ok": False, "error": {"code": "UNIFI_ERROR", "message": "Authorization failed."}},
        )

    set_status(db, redis_client, site_id=site.id, client_mac=portal_session.client_mac, status=PortalSessionStatus.AUTHORIZED)
    _log_auth_event(
        db,
        site=site,
        portal_session=portal_session,
        method=AuthMethod.EMAIL_OTP,
        result=AuthResult.SUCCESS,
        unifi_client_id=unifi_client_id,
        guest_identity=identity,
    )

    return {"ok": True, "data": {"continue_url": _continue_url(portal_session, site)}}


def _get_site(db: Session, tenant_slug: str, site_slug: str) -> Site:
    stmt = (
        select(Site)
        .join(Tenant, Tenant.id == Site.tenant_id)
        .where(Tenant.slug == tenant_slug, Site.slug == site_slug)
    )
    site = db.execute(stmt).scalar_one_or_none()
    if not site:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    return site


def _get_portal_session(db: Session, portal_session_id: str, site: Site) -> PortalSession:
    try:
        session_uuid = uuid.UUID(portal_session_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": "INVALID_SESSION", "message": "Invalid session."}},
        ) from exc

    stmt = select(PortalSession).where(
        PortalSession.id == session_uuid,
        PortalSession.site_id == site.id,
    )
    portal_session = db.execute(stmt).scalar_one_or_none()
    if not portal_session:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Session not found."}},
        )
    return portal_session


def _authorize_unifi(site: Site, client_mac: str) -> tuple[bool, str | None, str | None]:
    client = UnifiClient(
        site.unifi_base_url,
        site.unifi_api_key_ref,
        site.unifi_site_id,
        tenant_id=str(site.tenant_id),
        site_uuid=str(site.id),
    )
    try:
        unifi_client = client.find_client_by_mac(client_mac)
        if not unifi_client:
            return False, "CLIENT_NOT_FOUND", None
        client_id = unifi_client.get("id") or unifi_client.get("clientId")
        if not client_id:
            return False, "CLIENT_ID_MISSING", None
        policy = UnifiPolicy(
            time_limit_minutes=site.default_time_limit_minutes,
            data_limit_mb=site.default_data_limit_mb,
            rx_kbps=site.default_rx_kbps,
            tx_kbps=site.default_tx_kbps,
        )
        client.authorize_guest(client_id, policy)
        return True, None, client_id
    except Exception as exc:
        logger.error(
            "unifi_authorize_failed",
            tenant_id=str(site.tenant_id),
            site_id=str(site.id),
            error=str(exc),
        )
        return False, "UNIFI_ERROR", None


def _log_auth_event(
    db: Session,
    *,
    site: Site,
    portal_session: PortalSession,
    method: AuthMethod,
    result: AuthResult,
    reason: str | None = None,
    unifi_client_id: str | None = None,
    guest_identity: GuestIdentity | None = None,
) -> None:
    event = AuthEvent(
        tenant_id=site.tenant_id,
        site_id=site.id,
        portal_session_id=portal_session.id,
        guest_identity_id=guest_identity.id if guest_identity else None,
        method=method,
        result=result,
        reason=reason,
        unifi_client_id=unifi_client_id,
    )
    db.add(event)
    db.commit()


def _upsert_guest_identity(db: Session, tenant_id: uuid.UUID, email: str) -> GuestIdentity:
    stmt = select(GuestIdentity).where(GuestIdentity.tenant_id == tenant_id, GuestIdentity.email == email)
    identity = db.execute(stmt).scalar_one_or_none()
    if identity:
        return identity
    identity = GuestIdentity(tenant_id=tenant_id, email=email)
    db.add(identity)
    db.commit()
    db.refresh(identity)
    return identity


def _continue_url(portal_session: PortalSession, site: Site) -> str:
    if portal_session.orig_url:
        return portal_session.orig_url
    if site.success_url:
        return site.success_url
    return settings.BASE_URL
