from __future__ import annotations

import uuid
from typing import Callable, Sequence

from fastapi import Depends, HTTPException, Request
from itsdangerous import BadSignature, SignatureExpired
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import AdminRole, AdminUser
from app.security import parse_session_token
from app.settings import settings
from app.tenancy import ensure_tenant_access


ADMIN_SESSION_COOKIE = "admin_session"


def get_current_admin(
    request: Request,
    db: Session = Depends(get_db),
) -> AdminUser:
    token = request.cookies.get(ADMIN_SESSION_COOKIE)
    if not token:
        raise HTTPException(
            status_code=401,
            detail={"ok": False, "error": {"code": "UNAUTHENTICATED", "message": "Login required."}},
        )
    try:
        payload = parse_session_token(token, settings.ADMIN_SESSION_MAX_AGE_SECONDS)
    except (BadSignature, SignatureExpired):
        raise HTTPException(
            status_code=401,
            detail={"ok": False, "error": {"code": "UNAUTHENTICATED", "message": "Invalid session."}},
        )

    admin_user_id = payload.get("admin_user_id")
    if not admin_user_id:
        raise HTTPException(
            status_code=401,
            detail={"ok": False, "error": {"code": "UNAUTHENTICATED", "message": "Invalid session."}},
        )

    try:
        admin_user_uuid = uuid.UUID(admin_user_id)
    except ValueError:
        raise HTTPException(
            status_code=401,
            detail={"ok": False, "error": {"code": "UNAUTHENTICATED", "message": "Invalid session."}},
        )

    stmt = (
        select(AdminUser)
        .where(AdminUser.id == admin_user_uuid)
        .options(selectinload(AdminUser.memberships))
    )
    admin = db.execute(stmt).scalar_one_or_none()
    if not admin:
        raise HTTPException(
            status_code=401,
            detail={"ok": False, "error": {"code": "UNAUTHENTICATED", "message": "Invalid session."}},
        )
    return admin


def require_superadmin(
    admin_user: AdminUser = Depends(get_current_admin),
) -> AdminUser:
    if not admin_user.is_superadmin:
        raise HTTPException(
            status_code=403,
            detail={"ok": False, "error": {"code": "FORBIDDEN", "message": "Superadmin required."}},
        )
    return admin_user


def require_tenant_role(
    allowed_roles: Sequence[AdminRole],
) -> Callable[..., AdminUser]:
    def dependency(
        tenant_id: uuid.UUID,
        admin_user: AdminUser = Depends(get_current_admin),
        db: Session = Depends(get_db),
    ) -> AdminUser:
        ensure_tenant_access(db, admin_user, tenant_id, allowed_roles)
        return admin_user

    return dependency
