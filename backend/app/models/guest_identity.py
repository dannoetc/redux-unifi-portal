from __future__ import annotations

import uuid
from sqlalchemy import ForeignKey, Index, String, UniqueConstraint, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class GuestIdentity(Base, TimestampMixin):
    __tablename__ = "guest_identities"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
    )
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    oidc_sub: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    tenant = relationship("Tenant", back_populates="guest_identities")
    auth_events = relationship("AuthEvent", back_populates="guest_identity")

    __table_args__ = (
        UniqueConstraint("tenant_id", "email", name="uq_guest_identities_tenant_email"),
        UniqueConstraint("tenant_id", "oidc_sub", name="uq_guest_identities_tenant_oidc_sub"),
        Index("ix_guest_identities_tenant", "tenant_id"),
    )
