from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.models import AppSetting
from app.services.secrets import SecretError, decrypt_secret
from app.settings import settings

SMTP_SETTINGS_KEY = "system.smtp"
PREFERENCES_SETTINGS_KEY = "system.preferences"
DEFAULT_PREFERENCES = {
    "compact_tables": False,
    "show_setup_checklists": True,
}


def get_setting(db: Session, key: str) -> AppSetting | None:
    return db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()


def get_preferences(db: Session) -> dict[str, bool]:
    setting = get_setting(db, PREFERENCES_SETTINGS_KEY)
    raw = setting.value_json if setting and isinstance(setting.value_json, dict) else {}
    return {
        "compact_tables": bool(raw.get("compact_tables", DEFAULT_PREFERENCES["compact_tables"])),
        "show_setup_checklists": bool(raw.get("show_setup_checklists", DEFAULT_PREFERENCES["show_setup_checklists"])),
    }


def get_effective_smtp_settings(db: Session) -> dict[str, Any]:
    setting = get_setting(db, SMTP_SETTINGS_KEY)
    raw = setting.value_json if setting and isinstance(setting.value_json, dict) else {}

    password = settings.SMTP_PASSWORD or ""
    password_configured = bool(password)
    if setting and setting.value_encrypted:
        try:
            password = decrypt_secret(setting.value_encrypted)
            password_configured = True
        except SecretError:
            # Fall back to env-backed password if encrypted payload is invalid.
            password = settings.SMTP_PASSWORD or ""
            password_configured = bool(password)

    return {
        "host": str(raw.get("host", settings.SMTP_HOST)),
        "port": int(raw.get("port", settings.SMTP_PORT)),
        "username": str(raw.get("username", settings.SMTP_USERNAME or "")),
        "from_email": str(raw.get("from_email", settings.SMTP_FROM_EMAIL)),
        "from_name": str(raw.get("from_name", settings.SMTP_FROM_NAME)),
        "password": password,
        "password_configured": password_configured,
    }


def get_effective_smtp_settings_runtime() -> dict[str, Any]:
    try:
        with SessionLocal() as db:
            return get_effective_smtp_settings(db)
    except SQLAlchemyError:
        # During startup/migration windows, DB settings may be unavailable.
        return {
            "host": settings.SMTP_HOST,
            "port": settings.SMTP_PORT,
            "username": settings.SMTP_USERNAME or "",
            "from_email": settings.SMTP_FROM_EMAIL,
            "from_name": settings.SMTP_FROM_NAME,
            "password": settings.SMTP_PASSWORD or "",
            "password_configured": bool(settings.SMTP_PASSWORD),
        }
