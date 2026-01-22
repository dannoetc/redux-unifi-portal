from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class TenantOpenvpnClientProfile(Base, TimestampMixin):
    __tablename__ = "tenant_openvpn_client_profiles"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("tenants.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    profile_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)

    tenant = relationship("Tenant", back_populates="openvpn_client_profiles")
