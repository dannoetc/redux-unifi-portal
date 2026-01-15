from __future__ import annotations

import uuid
from sqlalchemy import Boolean, ForeignKey, Index, Integer, String, Text, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class Site(Base, TimestampMixin):
    __tablename__ = "sites"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")

    unifi_base_url: Mapped[str] = mapped_column(String(255), nullable=False)
    unifi_site_id: Mapped[str] = mapped_column(String(128), nullable=False)
    unifi_api_key_ref: Mapped[str] = mapped_column(String(255), nullable=False)

    default_time_limit_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    default_data_limit_mb: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_rx_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_tx_kbps: Mapped[int | None] = mapped_column(Integer, nullable=True)

    logo_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    primary_color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    terms_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    support_contact: Mapped[str | None] = mapped_column(String(255), nullable=True)
    success_url: Mapped[str | None] = mapped_column(String(512), nullable=True)

    tenant = relationship("Tenant", back_populates="sites")
    portal_sessions = relationship("PortalSession", back_populates="site")
    auth_events = relationship("AuthEvent", back_populates="site")
    voucher_batches = relationship("VoucherBatch", back_populates="site")
    oidc_settings = relationship("SiteOidcSetting", back_populates="site")

    __table_args__ = (
        Index("uq_sites_tenant_slug", "tenant_id", "slug", unique=True),
        Index("ix_sites_tenant", "tenant_id"),
    )
