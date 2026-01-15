from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone

from redis import Redis

from app.services.portal_session import normalize_mac
from app.settings import settings


@dataclass(frozen=True)
class OtpChallenge:
    code_hash: str
    attempts: int
    created_at: datetime


def otp_key(site_id: uuid.UUID, client_mac: str, email: str) -> str:
    normalized_mac = normalize_mac(client_mac)
    email_hash = hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()
    return f"otp:{site_id}:{normalized_mac}:{email_hash}"


def generate_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def _hash_code(code: str) -> str:
    return hmac.new(settings.SECRET_KEY.encode("utf-8"), code.encode("utf-8"), hashlib.sha256).hexdigest()


def start_challenge(redis_client: Redis, *, site_id: uuid.UUID, client_mac: str, email: str) -> str:
    code = generate_code()
    key = otp_key(site_id, client_mac, email)
    payload = {
        "code_hash": _hash_code(code),
        "attempts": 0,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    redis_client.setex(key, settings.OTP_TTL_SECONDS, json.dumps(payload))
    return code


def get_challenge(redis_client: Redis, *, site_id: uuid.UUID, client_mac: str, email: str) -> OtpChallenge | None:
    key = otp_key(site_id, client_mac, email)
    raw = redis_client.get(key)
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        created_at = datetime.fromisoformat(payload["created_at"])
        return OtpChallenge(
            code_hash=payload["code_hash"],
            attempts=int(payload["attempts"]),
            created_at=created_at,
        )
    except (KeyError, ValueError, json.JSONDecodeError):
        return None


def verify_code(
    redis_client: Redis,
    *,
    site_id: uuid.UUID,
    client_mac: str,
    email: str,
    code: str,
) -> tuple[bool, str | None]:
    key = otp_key(site_id, client_mac, email)
    challenge = get_challenge(redis_client, site_id=site_id, client_mac=client_mac, email=email)
    if not challenge:
        return False, "OTP_EXPIRED"

    if challenge.attempts >= settings.OTP_MAX_ATTEMPTS:
        redis_client.delete(key)
        return False, "OTP_LOCKED"

    expected = challenge.code_hash
    provided = _hash_code(code)
    if not hmac.compare_digest(expected, provided):
        attempts = challenge.attempts + 1
        payload = {
            "code_hash": expected,
            "attempts": attempts,
            "created_at": challenge.created_at.isoformat(),
        }
        redis_client.setex(key, settings.OTP_TTL_SECONDS, json.dumps(payload))
        if attempts >= settings.OTP_MAX_ATTEMPTS:
            redis_client.delete(key)
            return False, "OTP_LOCKED"
        return False, "OTP_INVALID"

    redis_client.delete(key)
    return True, None
