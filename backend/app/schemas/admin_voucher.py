from __future__ import annotations

from pydantic import BaseModel, Field


class VoucherBatchCreateRequest(BaseModel):
    name: str
    count: int = Field(ge=1, le=10000)
    code_length: int = Field(default=8, ge=6, le=16)
    expires_at: str | None = None
    max_uses_per_code: int = Field(default=1, ge=1, le=1000)
