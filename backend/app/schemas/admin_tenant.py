from __future__ import annotations

from pydantic import BaseModel


class TenantCreateRequest(BaseModel):
    name: str
    slug: str
    status: str | None = None


class TenantResponse(BaseModel):
    id: str
    name: str
    slug: str
    status: str
