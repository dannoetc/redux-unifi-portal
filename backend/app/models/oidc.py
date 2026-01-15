from __future__ import annotations

import uuid
from sqlalchemy import Boolean, ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class OidcProvider(Base):
    __tablename__ = "oidc_providers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    issuer: Mapped[str] = mapped_column(String(255), nullable=False)
    client_id: Mapped[str] = mapped_column(String(255), nullable=False)
    client_secret_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    scopes: Mapped[str] = mapped_column(String(255), nullable=False)

    tenant = relationship("Tenant", back_populates="oidc_providers")
    site_settings = relationship("SiteOidcSetting", back_populates="provider", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("tenant_id", "issuer", name="uq_oidc_providers_tenant_issuer"),
        Index("ix_oidc_providers_tenant", "tenant_id"),
    )


class SiteOidcSetting(Base):
    __tablename__ = "site_oidc_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    site_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sites.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("oidc_providers.id", ondelete="CASCADE"),
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")
    allowed_domains: Mapped[str | None] = mapped_column(String(255), nullable=True)

    site = relationship("Site", back_populates="oidc_settings")
    provider = relationship("OidcProvider", back_populates="site_settings")

    __table_args__ = (
        UniqueConstraint("site_id", "provider_id", name="uq_site_oidc_settings_site_provider"),
        Index("ix_site_oidc_settings_site", "site_id"),
    )
