from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import AdminRole


class AdminUser(Base):
    __tablename__ = "admin_users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_superadmin: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    memberships = relationship("AdminMembership", back_populates="admin_user", cascade="all, delete-orphan")


class AdminMembership(Base):
    __tablename__ = "admin_memberships"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    admin_user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="CASCADE"),
        nullable=False,
    )
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[AdminRole] = mapped_column(Enum(AdminRole, name="admin_role"), nullable=False)

    admin_user = relationship("AdminUser", back_populates="memberships")
    tenant = relationship("Tenant", back_populates="memberships")

    __table_args__ = (
        UniqueConstraint("admin_user_id", "tenant_id", name="uq_admin_memberships_user_tenant"),
        Index("ix_admin_memberships_tenant", "tenant_id"),
    )
