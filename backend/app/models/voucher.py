from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class VoucherBatch(Base, TimestampMixin):
    __tablename__ = "voucher_batches"

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
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    max_uses_per_code: Mapped[int] = mapped_column(Integer, nullable=False)

    tenant = relationship("Tenant", back_populates="voucher_batches")
    site = relationship("Site", back_populates="voucher_batches")
    vouchers = relationship("Voucher", back_populates="batch", cascade="all, delete-orphan")

    __table_args__ = (
        Index("ix_voucher_batches_tenant_site", "tenant_id", "site_id"),
    )


class Voucher(Base, TimestampMixin):
    __tablename__ = "vouchers"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    batch_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("voucher_batches.id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    uses: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    disabled: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false")

    batch = relationship("VoucherBatch", back_populates="vouchers")
    redemptions = relationship("VoucherRedemption", back_populates="voucher")

    __table_args__ = (
        UniqueConstraint("code", name="uq_vouchers_code"),
        Index("ix_vouchers_batch", "batch_id"),
    )


class VoucherRedemption(Base):
    __tablename__ = "voucher_redemptions"

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
    voucher_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("vouchers.id", ondelete="CASCADE"),
        nullable=False,
    )
    portal_session_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("portal_sessions.id", ondelete="SET NULL"),
        nullable=True,
    )
    client_mac: Mapped[str] = mapped_column(String(32), nullable=False)
    redeemed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    voucher = relationship("Voucher", back_populates="redemptions")
    portal_session = relationship("PortalSession", back_populates="voucher_redemptions")

    __table_args__ = (
        Index("ix_voucher_redemptions_tenant_site", "tenant_id", "site_id"),
        Index("ix_voucher_redemptions_voucher", "voucher_id"),
        Index("ix_voucher_redemptions_portal_session", "portal_session_id"),
    )
