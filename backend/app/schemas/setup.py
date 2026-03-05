from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


SLUG_PATTERN = r"^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$"


class SetupDefaultsResponse(BaseModel):
    admin_email: str = ""
    tenant_name: str = ""
    tenant_slug: str = ""
    site_slug: str = ""
    site_display_name: str = ""
    unifi_base_url: str = ""
    unifi_port: int = 443


class SetupStatusResponse(BaseModel):
    bootstrapped: bool
    has_superadmin: bool
    defaults: SetupDefaultsResponse


class SetupSiteRequest(BaseModel):
    site_slug: str = Field(min_length=2, pattern=SLUG_PATTERN)
    site_display_name: str = Field(min_length=2, max_length=255)
    unifi_site_id: str = Field(default="default", min_length=1, max_length=128)
    unifi_base_url: str | None = None
    unifi_port: int = Field(default=443, ge=1, le=65535)
    unifi_api_key: str | None = None


class SetupBootstrapRequest(BaseModel):
    admin_email: EmailStr
    admin_password: str = Field(min_length=8, max_length=255)
    tenant_name: str = Field(min_length=2, max_length=255)
    tenant_slug: str = Field(min_length=2, pattern=SLUG_PATTERN)
    create_initial_site: bool = False
    site: SetupSiteRequest | None = None

