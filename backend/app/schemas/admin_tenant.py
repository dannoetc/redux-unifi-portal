from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

class TenantCreateRequest(BaseModel):
    name: str
    slug: str
    status: str | None = None
    unifi_base_url: str | None = None
    unifi_api_key_ref: str | None = None
    is_roaming: bool | None = None
    openvpn_enabled: bool | None = None
    openvpn_profile_ref: str | None = Field(
        default=None,
        description="Env var name that stores the tenant-specific OpenVPN profile template.",
    )
    openvpn_profile_template: str | None = Field(
        default=None,
        description="Encrypted OpenVPN profile template content to store.",
    )
    openvpn_auth_ref: str | None = Field(
        default=None,
        description="Env var name containing auth-user-pass credentials (optional).",
    )
    openvpn_auth_blob: str | None = Field(
        default=None,
        description="Encrypted auth-user-pass payload to store (optional).",
    )
    openvpn_ca_ref: str | None = Field(
        default=None,
        description="Env var name containing a CA bundle to inline when missing from the profile.",
    )
    openvpn_ca_bundle: str | None = Field(
        default=None,
        description="Encrypted CA bundle content to store (optional).",
    )
    openvpn_remote_host: str | None = None
    openvpn_remote_port: int | None = None


class TenantUpdateRequest(BaseModel):
    name: str | None = None
    slug: str | None = None
    status: str | None = None
    unifi_base_url: str | None = None
    unifi_api_key_ref: str | None = None
    is_roaming: bool | None = None
    openvpn_enabled: bool | None = None
    openvpn_profile_ref: str | None = Field(
        default=None,
        description="Env var name that stores the tenant-specific OpenVPN profile template.",
    )
    openvpn_profile_template: str | None = Field(
        default=None,
        description="Encrypted OpenVPN profile template content to store.",
    )
    openvpn_auth_ref: str | None = Field(
        default=None,
        description="Env var name containing auth-user-pass credentials (optional).",
    )
    openvpn_auth_blob: str | None = Field(
        default=None,
        description="Encrypted auth-user-pass payload to store (optional).",
    )
    openvpn_ca_ref: str | None = Field(
        default=None,
        description="Env var name containing a CA bundle to inline when missing from the profile.",
    )
    openvpn_ca_bundle: str | None = Field(
        default=None,
        description="Encrypted CA bundle content to store (optional).",
    )
    openvpn_remote_host: str | None = None
    openvpn_remote_port: int | None = None


class TenantResponse(BaseModel):
    id: str
    name: str
    slug: str
    status: str
    unifi_base_url: str | None
    unifi_api_key_ref: str | None
    is_roaming: bool
    openvpn_enabled: bool
    openvpn_profile_ref: str | None = Field(
        description="Env var name that stores the tenant-specific OpenVPN profile template.",
    )
    openvpn_profile_stored: bool
    openvpn_auth_ref: str | None = Field(
        description="Env var name containing auth-user-pass credentials (optional).",
    )
    openvpn_auth_stored: bool
    openvpn_ca_ref: str | None = Field(
        description="Env var name containing a CA bundle to inline when missing from the profile.",
    )
    openvpn_ca_stored: bool
    openvpn_remote_host: str | None
    openvpn_remote_port: int | None
    openvpn_generated_client_name: str | None = None
    openvpn_generated_created_at: datetime | None = None
    openvpn_clients: list["OpenvpnClientResponse"] | None = None


class OpenvpnGenerateRequest(BaseModel):
    client_name: str


class OpenvpnClientResponse(BaseModel):
    id: str
    client_name: str
    created_at: datetime
