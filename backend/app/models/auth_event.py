from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Index, String, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base
from app.models.enums import AuthMethod, AuthResult


class AuthEvent(Base):
    __tablename__ = "auth_events"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    site_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
    )
    portal_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("portal_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    guest_identity_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("guest_identities.id", ondelete="SET NULL"),
        nullable=True,
    )
    method: Mapped[AuthMethod] = mapped_column(Enum(AuthMethod, name="auth_method"), nullable=False)
    result: Mapped[AuthResult] = mapped_column(Enum(AuthResult, name="auth_result"), nullable=False)
    reason: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unifi_client_id: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    tenant = relationship("Tenant", back_populates="auth_events")
    site = relationship("Site", back_populates="auth_events")
    portal_session = relationship("PortalSession", back_populates="auth_events")
    guest_identity = relationship("GuestIdentity", back_populates="auth_events")

    __table_args__ = (
        Index("ix_auth_events_tenant_created", "tenant_id", "created_at"),
        Index("ix_auth_events_site_created", "site_id", "created_at"),
        Index("ix_auth_events_portal_session", "portal_session_id"),
        Index("ix_auth_events_guest_identity", "guest_identity_id"),
    )
