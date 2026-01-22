from __future__ import annotations

import uuid

from sqlalchemy import LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin


class TenantOpenvpnSecret(Base, TimestampMixin):
    __tablename__ = "tenant_openvpn_secrets"

    tenant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
    )
    profile_template_encrypted: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    ca_bundle_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    auth_blob_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    encryption_version: Mapped[str] = mapped_column(String(32), nullable=False, default="v1")

    tenant = relationship("Tenant", back_populates="openvpn_secret")

