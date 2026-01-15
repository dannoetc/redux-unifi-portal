from __future__ import annotations

import time

from fastapi import HTTPException
from redis import Redis

from app.services.portal_session import normalize_mac


def limit_key_ip(ip: str, route: str) -> str:
    return f"ip:{route}:{ip}"


def limit_key_mac(site_id: str, client_mac: str, route: str) -> str:
    normalized = normalize_mac(client_mac)
    return f"mac:{route}:{site_id}:{normalized}"


def enforce_rate_limit(
    redis_client: Redis,
    *,
    scope_key: str,
    limit: int,
    window_seconds: int,
) -> None:
    window = int(time.time() // window_seconds)
    redis_key = f"rl:{scope_key}:{window}"
    count = redis_client.incr(redis_key)
    if count == 1:
        redis_client.expire(redis_key, window_seconds + 1)
    if count > limit:
        raise HTTPException(
            status_code=429,
            detail={"ok": False, "error": {"code": "RATE_LIMITED", "message": "Too many requests."}},
        )
