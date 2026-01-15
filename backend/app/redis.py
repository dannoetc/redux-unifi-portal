from __future__ import annotations

from redis import Redis

from app.settings import settings


def get_redis_client() -> Redis:
    return Redis.from_url(settings.REDIS_URL, decode_responses=True)
