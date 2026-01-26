from __future__ import annotations

import os

from cryptography.fernet import Fernet, InvalidToken

from app.settings import settings


class SecretError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def encrypt_secret(value: str) -> bytes:
    fernet = _get_fernet()
    return fernet.encrypt(value.encode("utf-8"))


def decrypt_secret(value: bytes) -> str:
    fernet = _get_fernet()
    try:
        decrypted = fernet.decrypt(value)
    except InvalidToken as exc:
        raise SecretError("SECRET_DECRYPT_FAILED", "Secret could not be decrypted.") from exc
    return decrypted.decode("utf-8")


def resolve_secret_value(
    *,
    encrypted: bytes | None,
    ref: str | None,
    missing_code: str,
    missing_message: str,
) -> str:
    if encrypted:
        return decrypt_secret(encrypted)
    if ref:
        env_value = os.environ.get(ref)
        if env_value:
            return env_value
        return ref
    raise SecretError(missing_code, missing_message)


def _get_fernet() -> Fernet:
    key = settings.SECRETS_ENCRYPTION_KEY or settings.OPENVPN_ENCRYPTION_KEY
    if not key:
        raise SecretError("SECRET_KEY_MISSING", "Secret encryption key is not configured.")
    try:
        return Fernet(key.encode("utf-8"))
    except ValueError as exc:
        raise SecretError("SECRET_KEY_INVALID", "Secret encryption key is invalid.") from exc
