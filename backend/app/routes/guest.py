from __future__ import annotations

import uuid
from typing import Dict
from urllib.parse import parse_qs, unquote, unquote_plus

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
    GuestTosAcceptRequest,
    GuestVoucherRequest,
)
from app.services.otp import start_challenge, verify_code
from app.services.portal_session import create_or_reuse_session, get_session, normalize_mac, set_status
from app.services.ratelimit import enforce_rate_limit, limit_key_ip, limit_key_mac
from app.services.secrets import SecretError, resolve_secret_value
from app.services.unifi import UnifiClient, UnifiPolicy
from app.services.vouchers import VoucherError, redeem_voucher
from app.tasks.otp import send_otp_email
from app.redis import get_redis_client
from app.settings import settings
import structlog

logger = structlog.get_logger(__name__)

router = APIRouter()


def _first_or_none(values):
    return values[0] if values else None


def parse_malformed_guest_params(request: Request) -> Dict[str, str]:
    """
    Read X-Original-URI or raw_path and return canonical params merged from
    the encoded path fragment (after /guest%3F) and the normal query string.
    """
    original = request.headers.get("X-Original-URI")
    if not original:
        raw_path = request.scope.get("raw_path") or ""
        if isinstance(raw_path, bytes):
            original = raw_path.decode("utf-8", errors="ignore")
        else:
            original = raw_path
        qs = request.scope.get("query_string")
        if qs:
            if isinstance(qs, bytes):
                qs = qs.decode("utf-8", errors="ignore")
            if qs:
                original += ("?" + qs) if "?" not in original else "&" + qs
    original = original or ""

    lower = original.lower()
    token = "/guest%3f"
    encoded_params = None
    if token in lower:
        idx = lower.index(token)
        start = idx + len(token)
        encoded_params = original[start:]
        if encoded_params.startswith("/"):
            encoded_params = encoded_params[1:]

    path_params = {}
    if encoded_params:
        try:
            decoded_once = unquote(encoded_params)
        except Exception:
            decoded_once = encoded_params
        if "%25" in decoded_once:
            try:
                decoded_once = unquote(decoded_once)
            except Exception:
                pass
        qs_map = parse_qs(decoded_once, keep_blank_values=True)
        for key, values in qs_map.items():
            path_params[key] = _first_or_none(values)

    query_params = {}
    try:
        for key, value in request.query_params.multi_items():
            if key not in query_params:
                query_params[key] = value
    except Exception:
        url_qs = request.url.query or ""
        if url_qs:
            for key, values in parse_qs(url_qs, keep_blank_values=True).items():
                query_params[key] = _first_or_none(values)

    merged = {}
    for source in (path_params, query_params):
        for key, value in source.items():
            if key not in merged and value is not None:
                decoded_value = value
                if "%25" in decoded_value:
                    try:
                        decoded_value = unquote(decoded_value)
                    except Exception:
                        pass
                try:
                    decoded_value = unquote_plus(decoded_value)
                except Exception:
                    pass
                merged[key] = decoded_value

    if encoded_params:
        logger.debug("parsed_malformed_guest_params", original=original, merged=merged)

    return merged


@router.post("/resolve")
def resolve_site(
    payload: GuestSessionInitRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    parsed_params = None
    normalized_client = None
    if payload.id:
        try:
            normalized_client = normalize_mac(payload.id)
        except ValueError:
            normalized_client = None

    if not normalized_client:
        if parsed_params is None:
            parsed_params = parse_malformed_guest_params(request)
        client_val = parsed_params.get("id") or parsed_params.get("client") or parsed_params.get("mac")
        if not client_val:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_MAC", "message": "Invalid client MAC address."}},
            )
        try:
            normalized_client = normalize_mac(client_val)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_MAC", "message": "Invalid client MAC address."}},
            ) from exc

    normalized_ap = None
    ap_candidate = None
    if payload.ap:
        try:
            ap_candidate = normalize_mac(payload.ap)
        except ValueError:
            ap_candidate = None
    if not ap_candidate:
        if parsed_params is None:
            parsed_params = parse_malformed_guest_params(request)
        ap_raw = parsed_params.get("ap")
        if ap_raw:
            try:
                ap_candidate = normalize_mac(ap_raw)
            except ValueError:
                ap_candidate = None
    normalized_ap = ap_candidate

    site, tenant = _resolve_site_by_unifi(db, normalized_client, normalized_ap)
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
        client_mac=normalized_client,
        ap_mac=normalized_ap,
        ssid=payload.ssid,
        orig_url=payload.url,
        ip=client_ip,
        user_agent=user_agent,
    )

    methods = ["voucher", "email_otp"]
    if site.enable_tos_only:
        methods.append("tos_only")
    oidc_enabled = db.execute(
        select(SiteOidcSetting.id).where(
            SiteOidcSetting.site_id == site.id, SiteOidcSetting.enabled.is_(True)
        )
    ).scalar_one_or_none()
    if oidc_enabled:
        methods.append("oidc")

    return {
        "ok": True,
        "data": {
            "tenant_slug": tenant.slug,
            "site_slug": site.slug,
            "portal_session_id": str(session.portal_session_id),
            "methods": methods,
        },
    }

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
    if site.enable_tos_only:
        methods.append("tos_only")
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
            "portal_template": {
                "enabled": site.portal_template_enabled,
                "html": site.portal_template_html,
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
    parsed_params = None
    normalized_client = None
    if payload.id:
        try:
            normalized_client = normalize_mac(payload.id)
        except ValueError:
            normalized_client = None
    if not normalized_client:
        if parsed_params is None:
            parsed_params = parse_malformed_guest_params(request)
        client_val = parsed_params.get("id") or parsed_params.get("client") or parsed_params.get("mac")
        if not client_val:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_MAC", "message": "Invalid client MAC address."}},
            )
        try:
            normalized_client = normalize_mac(client_val)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail={"ok": False, "error": {"code": "INVALID_MAC", "message": "Invalid client MAC address."}},
            ) from exc
    normalized_ap = None
    ap_candidate = None
    if payload.ap:
        try:
            ap_candidate = normalize_mac(payload.ap)
        except ValueError:
            ap_candidate = None
    if not ap_candidate:
        if parsed_params is None:
            parsed_params = parse_malformed_guest_params(request)
        ap_raw = parsed_params.get("ap")
        if ap_raw:
            try:
                ap_candidate = normalize_mac(ap_raw)
            except ValueError:
                ap_candidate = None
    normalized_ap = ap_candidate
    session = create_or_reuse_session(
        db,
        redis_client,
        tenant_id=site.tenant_id,
        site=site,
        client_mac=normalized_client,
        ap_mac=normalized_ap,
        ssid=payload.ssid,
        orig_url=payload.url,
        ip=client_ip,
        user_agent=user_agent,
    )

    methods = ["voucher", "email_otp"]
    if site.enable_tos_only:
        methods.append("tos_only")
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

    tenant = db.execute(select(Tenant).where(Tenant.id == site.tenant_id)).scalar_one_or_none()
    authorized, reason, unifi_client_id = _authorize_unifi(site, tenant, portal_session.client_mac)
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
        _raise_unifi_auth_error(reason)

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
    tenant = db.execute(select(Tenant).where(Tenant.id == site.tenant_id)).scalar_one_or_none()
    authorized, auth_reason, unifi_client_id = _authorize_unifi(site, tenant, portal_session.client_mac)
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
        _raise_unifi_auth_error(auth_reason)

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


@router.post("/{tenant_slug}/{site_slug}/tos/accept")
def tos_accept(
    tenant_slug: str,
    site_slug: str,
    payload: GuestTosAcceptRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> dict:
    site = _get_site(db, tenant_slug, site_slug)
    if not site.enabled:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    if not site.enable_tos_only:
        raise HTTPException(
            status_code=403,
            detail={"ok": False, "error": {"code": "TOS_ONLY_DISABLED", "message": "TOS-only access disabled."}},
        )

    portal_session = _get_portal_session(db, payload.portal_session_id, site)
    redis_client = get_redis_client()
    redis_session = get_session(redis_client, site.id, portal_session.client_mac)
    if not redis_session:
        raise HTTPException(
            status_code=410,
            detail={"ok": False, "error": {"code": "SESSION_EXPIRED", "message": "Session expired."}},
        )
    if str(redis_session.portal_session_id) != payload.portal_session_id:
        raise HTTPException(
            status_code=400,
            detail={"ok": False, "error": {"code": "SESSION_MISMATCH", "message": "Invalid session."}},
        )

    if redis_session.status == PortalSessionStatus.AUTHORIZED:
        if portal_session.status != PortalSessionStatus.AUTHORIZED:
            set_status(
                db,
                redis_client,
                site_id=site.id,
                client_mac=portal_session.client_mac,
                status=PortalSessionStatus.AUTHORIZED,
            )
        return {"ok": True, "data": {"continue_url": _continue_url(portal_session, site)}}

    client_ip = request.client.host if request.client else "unknown"
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_ip(client_ip, "tos_only"),
        limit=settings.VOUCHER_RATE_LIMIT_PER_IP,
        window_seconds=settings.VOUCHER_RATE_LIMIT_WINDOW_SECONDS,
    )
    enforce_rate_limit(
        redis_client,
        scope_key=limit_key_mac(str(site.id), portal_session.client_mac, "tos_only"),
        limit=settings.VOUCHER_RATE_LIMIT_PER_MAC,
        window_seconds=settings.VOUCHER_RATE_LIMIT_WINDOW_SECONDS,
    )

    tenant = db.execute(select(Tenant).where(Tenant.id == site.tenant_id)).scalar_one_or_none()
    authorized, reason, unifi_client_id = _authorize_unifi(site, tenant, portal_session.client_mac)
    if not authorized:
        set_status(
            db,
            redis_client,
            site_id=site.id,
            client_mac=portal_session.client_mac,
            status=PortalSessionStatus.FAILED,
        )
        _log_auth_event(
            db,
            site=site,
            portal_session=portal_session,
            method=AuthMethod.TOS_ONLY,
            result=AuthResult.FAIL,
            reason=reason,
            unifi_client_id=unifi_client_id,
        )
        _raise_unifi_auth_error(reason)

    set_status(
        db,
        redis_client,
        site_id=site.id,
        client_mac=portal_session.client_mac,
        status=PortalSessionStatus.AUTHORIZED,
    )
    _log_auth_event(
        db,
        site=site,
        portal_session=portal_session,
        method=AuthMethod.TOS_ONLY,
        result=AuthResult.SUCCESS,
        unifi_client_id=unifi_client_id,
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


def _resolve_unifi_api_key(site: Site, tenant: Tenant) -> str | None:
    api_key_ref = site.unifi_api_key_ref or tenant.unifi_api_key_ref
    api_key_encrypted = site.unifi_api_key_encrypted or tenant.unifi_api_key_encrypted
    if not (api_key_ref or api_key_encrypted):
        return None
    try:
        return resolve_secret_value(
            encrypted=api_key_encrypted,
            ref=api_key_ref,
            missing_code="UNIFI_CONFIG_MISSING",
            missing_message="UniFi controller settings are required.",
        )
    except SecretError as exc:
        logger.warning(
            "unifi_secret_resolve_failed",
            tenant_id=str(site.tenant_id),
            site_id=str(site.id),
            code=exc.code,
        )
        return None


def _resolve_site_by_unifi(db: Session, client_mac: str, ap_mac: str | None) -> tuple[Site, Tenant]:
    tenant_results = db.execute(select(Tenant)).scalars().all()
    if ap_mac:
        for tenant in tenant_results:
            sites = db.execute(select(Site).where(Site.tenant_id == tenant.id)).scalars().all()
            for site in sites:
                if not site.enabled:
                    continue
                base_url = site.unifi_base_url or tenant.unifi_base_url
                api_key = _resolve_unifi_api_key(site, tenant)
                if not base_url or not api_key:
                    continue
                try:
                    client = UnifiClient(
                        base_url,
                        api_key,
                        site.unifi_site_id,
                        tenant_id=str(site.tenant_id),
                        site_uuid=str(site.id),
                        timeout_s=3.0,
                        verify_ssl=settings.UNIFI_VERIFY_SSL,
                    )
                    devices = client.get_devices_by_mac(ap_mac)
                    if not devices:
                        lowered = ap_mac.lower()
                        if lowered != ap_mac:
                            devices = client.get_devices_by_mac(lowered)
                except Exception as exc:
                    logger.warning(
                        "unifi_ap_lookup_failed",
                        tenant_id=str(site.tenant_id),
                        site_id=str(site.id),
                        error=str(exc),
                    )
                    continue
                if devices:
                    device_site_id = (
                        devices[0].get("siteId")
                        or devices[0].get("site_id")
                        or devices[0].get("site")
                    )
                    if device_site_id:
                        matched_site = (
                            db.execute(
                                select(Site).where(
                                    Site.tenant_id == tenant.id,
                                    Site.unifi_site_id == device_site_id,
                                )
                            )
                            .scalars()
                            .first()
                        )
                        if matched_site:
                            return matched_site, tenant
                    return site, tenant

    for tenant in tenant_results:
        sites = db.execute(select(Site).where(Site.tenant_id == tenant.id)).scalars().all()
        for site in sites:
            if not site.enabled:
                continue
            base_url = site.unifi_base_url or tenant.unifi_base_url
            api_key = _resolve_unifi_api_key(site, tenant)
            if not base_url or not api_key:
                continue
            try:
                client = UnifiClient(
                    base_url,
                    api_key,
                    site.unifi_site_id,
                    tenant_id=str(site.tenant_id),
                    site_uuid=str(site.id),
                    timeout_s=3.0,
                    verify_ssl=settings.UNIFI_VERIFY_SSL,
                )
                unifi_client = client.find_client_by_mac(client_mac)
            except Exception as exc:
                logger.warning(
                    "unifi_site_lookup_failed",
                    tenant_id=str(site.tenant_id),
                    site_id=str(site.id),
                    error=str(exc),
                )
                continue
            if unifi_client:
                return site, tenant
    raise HTTPException(
        status_code=404,
        detail={"ok": False, "error": {"code": "SITE_RESOLVE_FAILED", "message": "Unable to resolve site."}},
    )


def _raise_unifi_auth_error(reason: str | None) -> None:
    if reason == "CLIENT_NOT_FOUND":
        raise HTTPException(
            status_code=409,
            detail={
                "ok": False,
                "error": {
                    "code": "CLIENT_NOT_FOUND",
                    "message": "Client not yet connected. Please retry.",
                },
            },
        )
    if reason == "UNIFI_CONFIG_MISSING":
        raise HTTPException(
            status_code=500,
            detail={
                "ok": False,
                "error": {"code": "UNIFI_CONFIG_MISSING", "message": "Authorization unavailable."},
            },
        )
    raise HTTPException(
        status_code=502,
        detail={"ok": False, "error": {"code": "UNIFI_ERROR", "message": "Authorization failed."}},
    )


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


def _authorize_unifi(site: Site, tenant: Tenant | None, client_mac: str) -> tuple[bool, str | None, str | None]:
    if not tenant:
        return False, "TENANT_NOT_FOUND", None
    base_url = site.unifi_base_url or tenant.unifi_base_url
    api_key = _resolve_unifi_api_key(site, tenant)
    if not base_url or not api_key:
        return False, "UNIFI_CONFIG_MISSING", None
    client = UnifiClient(
        base_url,
        api_key,
        site.unifi_site_id,
        tenant_id=str(site.tenant_id),
        site_uuid=str(site.id),
        verify_ssl=settings.UNIFI_VERIFY_SSL,
    )
    try:
        unifi_client = client.find_client_by_mac(
            client_mac,
            attempts=settings.UNIFI_CLIENT_LOOKUP_ATTEMPTS,
            backoff_s=settings.UNIFI_CLIENT_LOOKUP_BACKOFF_SECONDS,
        )
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
