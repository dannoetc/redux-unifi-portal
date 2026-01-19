from __future__ import annotations

import threading
import time
from typing import Any

import structlog
from redis import Redis

from app.settings import settings

logger = structlog.get_logger(__name__)

_redis_client: Redis | "InMemoryRedis" | None = None


class InMemoryRedis:
    def __init__(self) -> None:
        self._data: dict[str, tuple[Any, float | None]] = {}
        self._lock = threading.Lock()

    def _purge_if_expired(self, key: str) -> None:
        value = self._data.get(key)
        if not value:
            return
        _, expires_at = value
        if expires_at is not None and time.time() >= expires_at:
            self._data.pop(key, None)

    def get(self, key: str) -> Any:
        with self._lock:
            self._purge_if_expired(key)
            value = self._data.get(key)
            return value[0] if value else None

    def setex(self, key: str, ttl_seconds: int, value: Any) -> bool:
        expires_at = time.time() + ttl_seconds
        with self._lock:
            self._data[key] = (value, expires_at)
        return True

    def delete(self, key: str) -> int:
        with self._lock:
            self._purge_if_expired(key)
            existed = key in self._data
            self._data.pop(key, None)
        return 1 if existed else 0

    def incr(self, key: str) -> int:
        with self._lock:
            self._purge_if_expired(key)
            current = self._data.get(key)
            value = int(current[0]) if current else 0
            value += 1
            self._data[key] = (value, current[1] if current else None)
            return value

    def expire(self, key: str, ttl_seconds: int) -> bool:
        with self._lock:
            self._purge_if_expired(key)
            if key not in self._data:
                return False
            value, _ = self._data[key]
            self._data[key] = (value, time.time() + ttl_seconds)
        return True


def get_redis_client() -> Redis | InMemoryRedis:
    global _redis_client
    if _redis_client is not None:
        return _redis_client
    if settings.REDIS_URL.startswith("memory://"):
        _redis_client = InMemoryRedis()
        logger.warning("redis_in_memory", reason="memory_url_configured")
        return _redis_client
    client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        client.ping()
        _redis_client = client
        return _redis_client
    except Exception as exc:
        logger.warning("redis_fallback_in_memory", error=str(exc))
        _redis_client = InMemoryRedis()
        return _redis_client
