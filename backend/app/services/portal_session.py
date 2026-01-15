from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import structlog
from redis import Redis
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import PortalSession, PortalSessionStatus, Site
from app.redis import get_redis_client

logger = structlog.get_logger(__name__)

PORTAL_SESSION_TTL_SECONDS = 60 * 30


@dataclass(frozen=True)
class PortalSessionData:
    portal_session_id: uuid.UUID
    client_mac: str
    ap_mac: str | None
    ssid: str | None
    orig_url: str | None
    created_at: datetime
    status: PortalSessionStatus


def portal_session_key(site_id: uuid.UUID, client_mac: str) -> str:
    return f"ps:{site_id}:{client_mac}"


def normalize_mac(raw_mac: str) -> str:
    hex_chars = re.sub(r"[^0-9a-fA-F]", "", raw_mac or "")
    if len(hex_chars) != 12:
        raise ValueError("Invalid MAC address.")
    pairs = [hex_chars[i : i + 2] for i in range(0, 12, 2)]
    return ":".join(pairs).upper()


def sanitize_orig_url(url: str | None, max_len: int = 2048) -> str | None:
    if not url:
        return None
    cleaned = url.replace("\n", "").replace("\r", "")
    return cleaned[:max_len]


def _serialize_session(data: PortalSessionData) -> str:
    payload = {
        "portal_session_id": str(data.portal_session_id),
        "client_mac": data.client_mac,
        "ap_mac": data.ap_mac,
        "ssid": data.ssid,
        "orig_url": data.orig_url,
        "created_at": data.created_at.isoformat(),
        "status": data.status.value,
    }
    return json.dumps(payload)


def _deserialize_session(raw: str) -> PortalSessionData:
    payload = json.loads(raw)
    return PortalSessionData(
        portal_session_id=uuid.UUID(payload["portal_session_id"]),
        client_mac=payload["client_mac"],
        ap_mac=payload.get("ap_mac"),
        ssid=payload.get("ssid"),
        orig_url=payload.get("orig_url"),
        created_at=datetime.fromisoformat(payload["created_at"]),
        status=PortalSessionStatus(payload["status"]),
    )


def get_session(redis_client: Redis, site_id: uuid.UUID, client_mac: str) -> PortalSessionData | None:
    key = portal_session_key(site_id, client_mac)
    raw = redis_client.get(key)
    if not raw:
        return None
    try:
        return _deserialize_session(raw)
    except (ValueError, KeyError, json.JSONDecodeError):
        logger.warning("portal_session_redis_corrupt", site_id=str(site_id), client_mac=client_mac)
        return None


def create_or_reuse_session(
    db: Session,
    redis_client: Redis,
    *,
    tenant_id: uuid.UUID,
    site: Site,
    client_mac: str,
    ap_mac: str | None,
    ssid: str | None,
    orig_url: str | None,
    ip: str | None,
    user_agent: str | None,
) -> PortalSessionData:
    normalized_client = normalize_mac(client_mac)
    normalized_ap = normalize_mac(ap_mac) if ap_mac else None
    sanitized_url = sanitize_orig_url(orig_url)

    existing = get_session(redis_client, site.id, normalized_client)
    if existing:
        stmt = select(PortalSession).where(PortalSession.id == existing.portal_session_id)
        db_row = db.execute(stmt).scalar_one_or_none()
        if db_row:
            return existing

    portal_session = PortalSession(
        tenant_id=tenant_id,
        site_id=site.id,
        client_mac=normalized_client,
        ap_mac=normalized_ap,
        ssid=ssid,
        orig_url=sanitized_url,
        ip=ip,
        user_agent=user_agent,
        status=PortalSessionStatus.STARTED,
    )
    db.add(portal_session)
    db.commit()
    db.refresh(portal_session)

    created_at = portal_session.created_at or datetime.now(timezone.utc)
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    data = PortalSessionData(
        portal_session_id=portal_session.id,
        client_mac=normalized_client,
        ap_mac=normalized_ap,
        ssid=ssid,
        orig_url=sanitized_url,
        created_at=created_at,
        status=portal_session.status,
    )
    key = portal_session_key(site.id, normalized_client)
    redis_client.setex(key, PORTAL_SESSION_TTL_SECONDS, _serialize_session(data))
    return data


def set_status(
    db: Session,
    redis_client: Redis,
    *,
    site_id: uuid.UUID,
    client_mac: str,
    status: PortalSessionStatus,
) -> None:
    normalized_client = normalize_mac(client_mac)
    existing = get_session(redis_client, site_id, normalized_client)
    if existing:
        updated = PortalSessionData(
            portal_session_id=existing.portal_session_id,
            client_mac=existing.client_mac,
            ap_mac=existing.ap_mac,
            ssid=existing.ssid,
            orig_url=existing.orig_url,
            created_at=existing.created_at,
            status=status,
        )
        redis_client.setex(
            portal_session_key(site_id, normalized_client),
            PORTAL_SESSION_TTL_SECONDS,
            _serialize_session(updated),
        )

    stmt = select(PortalSession).where(
        PortalSession.site_id == site_id, PortalSession.client_mac == normalized_client
    )
    portal_session = db.execute(stmt).scalar_one_or_none()
    if portal_session:
        portal_session.status = status
        db.add(portal_session)
        db.commit()
