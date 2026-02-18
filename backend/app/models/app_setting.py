from __future__ import annotations

import uuid

from sqlalchemy import JSON, LargeBinary, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AppSetting(Base, TimestampMixin):
    __tablename__ = "app_settings"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4)
    key: Mapped[str] = mapped_column(String(128), unique=True, nullable=False, index=True)
    value_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    value_encrypted: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
