from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text, Uuid, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base


class SitePortalTemplateVersion(Base):
    __tablename__ = "site_portal_template_versions"

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
    portal_template_mode: Mapped[str] = mapped_column(String(16), nullable=False)
    portal_template_html: Mapped[str | None] = mapped_column(Text, nullable=True)
    portal_template_theme: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_by_admin_user_id: Mapped[uuid.UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("admin_users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    site = relationship("Site", back_populates="portal_template_versions")

    __table_args__ = (
        Index("ix_site_portal_template_versions_site_created", "site_id", "created_at"),
        Index("ix_site_portal_template_versions_tenant_created", "tenant_id", "created_at"),
    )
