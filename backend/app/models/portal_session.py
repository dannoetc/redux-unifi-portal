from __future__ import annotations

import uuid
from sqlalchemy import Enum, ForeignKey, Index, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin
from app.models.enums import PortalSessionStatus


class PortalSession(Base, TimestampMixin):
    __tablename__ = "portal_sessions"

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
    client_mac: Mapped[str] = mapped_column(String(32), nullable=False)
    ap_mac: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ssid: Mapped[str | None] = mapped_column(String(128), nullable=True)
    orig_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(512), nullable=True)
    status: Mapped[PortalSessionStatus] = mapped_column(
        Enum(PortalSessionStatus, name="portal_session_status"),
        nullable=False,
        default=PortalSessionStatus.STARTED,
    )

    tenant = relationship("Tenant", back_populates="portal_sessions")
    site = relationship("Site", back_populates="portal_sessions")
    auth_events = relationship("AuthEvent", back_populates="portal_session")
    voucher_redemptions = relationship("VoucherRedemption", back_populates="portal_session")

    __table_args__ = (
        Index("ix_portal_sessions_site_client", "site_id", "client_mac"),
        Index("ix_portal_sessions_tenant_created", "tenant_id", "created_at"),
        Index("ix_portal_sessions_site_created", "site_id", "created_at"),
    )
