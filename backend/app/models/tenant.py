from __future__ import annotations

import uuid
from sqlalchemy import Boolean, Enum, Integer, String, Uuid
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
    unifi_base_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    unifi_api_key_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_roaming: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    openvpn_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    openvpn_profile_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openvpn_auth_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openvpn_ca_ref: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openvpn_remote_host: Mapped[str | None] = mapped_column(String(255), nullable=True)
    openvpn_remote_port: Mapped[int | None] = mapped_column(Integer, nullable=True)

    sites = relationship("Site", back_populates="tenant", cascade="all, delete-orphan")
    memberships = relationship("AdminMembership", back_populates="tenant", cascade="all, delete-orphan")
    portal_sessions = relationship("PortalSession", back_populates="tenant", passive_deletes=True)
    guest_identities = relationship("GuestIdentity", back_populates="tenant", passive_deletes=True)
    auth_events = relationship("AuthEvent", back_populates="tenant", passive_deletes=True)
    voucher_batches = relationship("VoucherBatch", back_populates="tenant", passive_deletes=True)
    oidc_providers = relationship("OidcProvider", back_populates="tenant", passive_deletes=True)
    openvpn_secret = relationship(
        "TenantOpenvpnSecret",
        back_populates="tenant",
        cascade="all, delete-orphan",
        uselist=False,
    )
