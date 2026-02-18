from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class TlsStatusResponse(BaseModel):
    mode: Literal["letsencrypt", "custom"]
    domain: str
    certificate_present: bool
    managed_by_certbot: bool
    issuer: str | None = None
    subject: str | None = None
    not_before: str | None = None
    not_after: str | None = None
    self_signed: bool | None = None


class TlsCustomCertificateRequest(BaseModel):
    certificate_pem: str
    private_key_pem: str


class TlsModeUpdateRequest(BaseModel):
    mode: Literal["letsencrypt"]
