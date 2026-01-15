from __future__ import annotations

import uuid
from typing import Any

from itsdangerous import URLSafeTimedSerializer
from passlib.context import CryptContext

from app.settings import settings


_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return _pwd_context.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return _pwd_context.verify(password, hashed_password)


def get_serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(settings.SECRET_KEY, salt="admin-session")


def create_session_token(admin_user_id: uuid.UUID) -> str:
    serializer = get_serializer()
    return serializer.dumps({"admin_user_id": str(admin_user_id)})


def parse_session_token(token: str, max_age_seconds: int) -> dict[str, Any]:
    serializer = get_serializer()
    return serializer.loads(token, max_age=max_age_seconds)
