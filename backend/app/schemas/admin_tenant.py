from __future__ import annotations

from pydantic import BaseModel, Field

class TenantCreateRequest(BaseModel):
    name: str
    slug: str
    status: str | None = None
    unifi_base_url: str | None = None
    unifi_api_key_ref: str | None = None
    unifi_api_key: str | None = Field(
        default=None,
        description="Plaintext UniFi API key to encrypt and store.",
    )


class TenantUpdateRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    status: str | None = None
    unifi_base_url: str | None = None
    unifi_api_key_ref: str | None = None
    unifi_api_key: str | None = Field(
        default=None,
        description="Plaintext UniFi API key to encrypt and store.",
    )


class TenantResponse(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    unifi_base_url: str | None
    unifi_api_key_ref: str | None
    unifi_api_key_stored: bool
