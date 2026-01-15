from __future__ import annotations

import uuid
from typing import Iterable, Sequence

from fastapi import HTTPException
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.models import AdminMembership, AdminRole, AdminUser


def scope_tenant(stmt: Select, tenant_id: uuid.UUID, model: type) -> Select:
    return stmt.where(getattr(model, "tenant_id") == tenant_id)


def ensure_tenant_access(
    db: Session,
    admin_user: AdminUser,
    tenant_id: uuid.UUID,
    allowed_roles: Sequence[AdminRole] | None = None,
) -> AdminMembership:
    if admin_user.is_superadmin:
        membership = AdminMembership(
            admin_user_id=admin_user.id,
            tenant_id=tenant_id,
            role=AdminRole.TENANT_ADMIN,
        )
        return membership

    roles: Iterable[AdminRole]
    if allowed_roles:
        roles = allowed_roles
    else:
        roles = (AdminRole.TENANT_ADMIN, AdminRole.TENANT_VIEWER)

    stmt = select(AdminMembership).where(
        AdminMembership.admin_user_id == admin_user.id,
        AdminMembership.tenant_id == tenant_id,
    )
    membership = db.execute(stmt).scalar_one_or_none()
    if not membership or membership.role not in roles:
        raise HTTPException(
            status_code=403,
            detail={"ok": False, "error": {"code": "FORBIDDEN", "message": "Access denied."}},
        )
    return membership
