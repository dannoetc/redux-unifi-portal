from __future__ import annotations

import uuid
from pydantic import BaseModel


class OidcProviderCreateRequest(BaseModel):
    issuer: str
    client_id: str
    client_secret_ref: str
    scopes: str


class OidcProviderUpdateRequest(BaseModel):
    issuer: str | None = None
    client_id: str | None = None
    client_secret_ref: str | None = None
    scopes: str | None = None


class OidcProviderResponse(BaseModel):
    id: uuid.UUID
    issuer: str
    client_id: str
    client_secret_ref: str
    scopes: str


class SiteOidcUpdateRequest(BaseModel):
    enabled: bool
    oidc_provider_id: uuid.UUID
    allowed_email_domains: list[str] | None = None


class SiteOidcResponse(BaseModel):
    enabled: bool
    oidc_provider_id: uuid.UUID
    allowed_email_domains: list[str] | None = None
