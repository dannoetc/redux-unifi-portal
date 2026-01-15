from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
import structlog

from app.db import get_db
from app.models import (
    AuthEvent,
    AuthMethod,
    AuthResult,
    GuestIdentity,
    OidcProvider,
    PortalSession,
    PortalSessionStatus,
    Site,
    SiteOidcSetting,
    Tenant,
)
from app.redis import get_redis_client
from app.services.oidc import (
    OidcError,
    build_oauth_client,
    clear_oidc_state,
    discover_provider_metadata,
    exchange_code_for_claims,
    generate_code_verifier,
    generate_nonce,
    generate_state_token,
    get_oidc_state,
    store_oidc_state,
)
from app.services.portal_session import set_status
from app.services.unifi import UnifiClient, UnifiPolicy
from app.settings import settings

logger = structlog.get_logger(__name__)

router = APIRouter()


@router.get("/{tenant_slug}/{site_slug}/start")
def oidc_start(
    tenant_slug: str,
    site_slug: str,
    portal_session_id: str,
    request: Request,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    site = _get_site(db, tenant_slug, site_slug)
    if not site.enabled:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )
    portal_session = _get_portal_session(db, portal_session_id, site)
    setting, provider = _get_oidc_setting(db, site)

    redis_client = get_redis_client()
    state = generate_state_token(portal_session.id)
    nonce = generate_nonce()
    code_verifier = generate_code_verifier()
    store_oidc_state(
        redis_client,
        portal_session_id=portal_session.id,
        state=state,
        nonce=nonce,
        code_verifier=code_verifier,
        provider_id=provider.id,
    )

    redirect_uri = str(request.url_for("oidc_callback", tenant_slug=tenant_slug, site_slug=site_slug))
    metadata = discover_provider_metadata(provider.issuer)
    client = build_oauth_client(
        client_id=provider.client_id,
        client_secret_ref=provider.client_secret_ref,
        scopes=provider.scopes,
        redirect_uri=redirect_uri,
    )
    auth_url, _ = client.create_authorization_url(
        metadata.authorization_endpoint,
        state=state,
        code_verifier=code_verifier,
        nonce=nonce,
    )
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/callback/{tenant_slug}/{site_slug}", name="oidc_callback")
def oidc_callback(
    tenant_slug: str,
    site_slug: str,
    request: Request,
    state: str | None = None,
    code: str | None = None,
    error: str | None = None,
    error_description: str | None = None,
    db: Session = Depends(get_db),
) -> RedirectResponse:
    site = _get_site(db, tenant_slug, site_slug)
    if not site.enabled:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "NOT_FOUND", "message": "Site not found."}},
        )

    if error:
        logger.info("oidc_provider_error", error=error, description=error_description)
        return _error_redirect(tenant_slug, site_slug, None, "OIDC_PROVIDER_ERROR")

    if not state or not code:
        return _error_redirect(tenant_slug, site_slug, None, "OIDC_STATE_INVALID")

    portal_session_id = _portal_session_from_state(state)
    if not portal_session_id:
        return _error_redirect(tenant_slug, site_slug, None, "OIDC_STATE_INVALID")

    redis_client = get_redis_client()
    stored = get_oidc_state(redis_client, portal_session_id=portal_session_id)
    if not stored or stored.state != state:
        return _error_redirect(tenant_slug, site_slug, str(portal_session_id), "OIDC_STATE_INVALID")

    setting, provider = _get_oidc_setting(db, site)
    if provider.id != stored.provider_id:
        return _error_redirect(tenant_slug, site_slug, str(portal_session_id), "OIDC_PROVIDER_MISMATCH")

    portal_session = _get_portal_session(db, str(portal_session_id), site)
    redirect_uri = str(request.url_for("oidc_callback", tenant_slug=tenant_slug, site_slug=site_slug))
    try:
        claims = exchange_code_for_claims(
            issuer=provider.issuer,
            client_id=provider.client_id,
            client_secret_ref=provider.client_secret_ref,
            scopes=provider.scopes,
            redirect_uri=redirect_uri,
            code=code,
            code_verifier=stored.code_verifier,
            nonce=stored.nonce,
        )
    except OidcError as exc:
        _mark_failed(db, redis_client, site, portal_session, exc.code)
        return _error_redirect(tenant_slug, site_slug, str(portal_session_id), exc.code)

    oidc_sub = claims.get("sub")
    email = claims.get("email")
    display_name = claims.get("name") or claims.get("preferred_username")
    if not oidc_sub:
        _mark_failed(db, redis_client, site, portal_session, "OIDC_SUB_MISSING")
        return _error_redirect(tenant_slug, site_slug, str(portal_session_id), "OIDC_SUB_MISSING")

    allowed_domains = _parse_domains(setting.allowed_domains)
    if allowed_domains:
        if not email or _email_domain(email) not in allowed_domains:
            _mark_failed(db, redis_client, site, portal_session, "OIDC_DOMAIN_DENIED")
            return _error_redirect(tenant_slug, site_slug, str(portal_session_id), "OIDC_DOMAIN_DENIED")

    identity = _upsert_guest_identity(
        db,
        tenant_id=site.tenant_id,
        oidc_sub=oidc_sub,
        email=email,
        display_name=display_name,
    )
    authorized, reason, unifi_client_id = _authorize_unifi(site, portal_session.client_mac)
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
            method=AuthMethod.OIDC,
            result=AuthResult.FAIL,
            reason=reason,
            unifi_client_id=unifi_client_id,
            guest_identity=identity,
        )
        return _error_redirect(tenant_slug, site_slug, str(portal_session_id), "UNIFI_ERROR")

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
        method=AuthMethod.OIDC,
        result=AuthResult.SUCCESS,
        unifi_client_id=unifi_client_id,
        guest_identity=identity,
    )
    clear_oidc_state(redis_client, portal_session_id=portal_session.id)
    return _success_redirect(tenant_slug, site_slug, str(portal_session_id))


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


def _get_oidc_setting(db: Session, site: Site) -> tuple[SiteOidcSetting, OidcProvider]:
    stmt = (
        select(SiteOidcSetting, OidcProvider)
        .join(OidcProvider, SiteOidcSetting.provider_id == OidcProvider.id)
        .where(SiteOidcSetting.site_id == site.id, SiteOidcSetting.enabled.is_(True))
    )
    result = db.execute(stmt).first()
    if not result:
        raise HTTPException(
            status_code=404,
            detail={"ok": False, "error": {"code": "OIDC_DISABLED", "message": "OIDC not enabled."}},
        )
    setting, provider = result
    return setting, provider


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


def _upsert_guest_identity(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    oidc_sub: str,
    email: str | None,
    display_name: str | None,
) -> GuestIdentity:
    stmt = select(GuestIdentity).where(
        GuestIdentity.tenant_id == tenant_id,
        GuestIdentity.oidc_sub == oidc_sub,
    )
    identity = db.execute(stmt).scalar_one_or_none()
    if identity:
        identity.email = email
        identity.display_name = display_name
        db.add(identity)
        db.commit()
        db.refresh(identity)
        return identity

    identity = GuestIdentity(
        tenant_id=tenant_id,
        oidc_sub=oidc_sub,
        email=email,
        display_name=display_name,
    )
    db.add(identity)
    db.commit()
    db.refresh(identity)
    return identity


def _mark_failed(
    db: Session,
    redis_client,
    site: Site,
    portal_session: PortalSession,
    reason: str,
) -> None:
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
        method=AuthMethod.OIDC,
        result=AuthResult.FAIL,
        reason=reason,
    )


def _portal_session_from_state(state: str) -> uuid.UUID | None:
    if "." not in state:
        return None
    candidate = state.split(".", 1)[0]
    try:
        return uuid.UUID(candidate)
    except ValueError:
        return None


def _parse_domains(domains: str | None) -> set[str]:
    if not domains:
        return set()
    return {value.strip().lower() for value in domains.split(",") if value.strip()}


def _email_domain(email: str) -> str:
    if "@" not in email:
        return ""
    return email.split("@", 1)[1].lower()


def _success_redirect(tenant_slug: str, site_slug: str, portal_session_id: str) -> RedirectResponse:
    url = f"{settings.BASE_URL}/guest/s/{tenant_slug}/{site_slug}/?portal_session_id={portal_session_id}"
    return RedirectResponse(url=url, status_code=302)


def _error_redirect(
    tenant_slug: str, site_slug: str, portal_session_id: str | None, code: str
) -> RedirectResponse:
    base = f"{settings.BASE_URL}/guest/s/{tenant_slug}/{site_slug}/"
    if portal_session_id:
        url = f"{base}?portal_session_id={portal_session_id}&error={code}"
    else:
        url = f"{base}?error={code}"
    return RedirectResponse(url=url, status_code=302)
