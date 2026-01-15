from __future__ import annotations

import uuid
from sqlalchemy import Enum, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import TenantStatus


class Tenant(Base, TimestampMixin):
    __tablename__ = "tenants"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[TenantStatus] = mapped_column(
        Enum(TenantStatus, name="tenant_status"),
        nullable=False,
        default=TenantStatus.ACTIVE,
    )

    sites = relationship("Site", back_populates="tenant", cascade="all, delete-orphan")
    memberships = relationship("AdminMembership", back_populates="tenant", cascade="all, delete-orphan")
    portal_sessions = relationship("PortalSession", back_populates="tenant")
    guest_identities = relationship("GuestIdentity", back_populates="tenant")
    auth_events = relationship("AuthEvent", back_populates="tenant")
    voucher_batches = relationship("VoucherBatch", back_populates="tenant")
    oidc_providers = relationship("OidcProvider", back_populates="tenant")
