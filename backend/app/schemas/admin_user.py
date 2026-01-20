from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import AdminRole


class AdminUserCreateRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)
    role: AdminRole = AdminRole.TENANT_ADMIN


class AdminUserResponse(BaseModel):
    id: str
    email: str
    role: str
    is_superadmin: bool
    created_at: datetime
