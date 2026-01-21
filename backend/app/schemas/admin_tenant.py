from __future__ import annotations

from pydantic import BaseModel


class TenantCreateRequest(BaseModel):
    name: str
    slug: str
    status: str | None = None
    unifi_base_url: str | None = None
    unifi_api_key_ref: str | None = None
    is_roaming: bool | None = None
    openvpn_enabled: bool | None = None
    openvpn_profile_ref: str | None = None
    openvpn_auth_ref: str | None = None
    openvpn_ca_ref: str | None = None
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
    openvpn_profile_ref: str | None = None
    openvpn_auth_ref: str | None = None
    openvpn_ca_ref: str | None = None
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
    openvpn_profile_ref: str | None
    openvpn_auth_ref: str | None
    openvpn_ca_ref: str | None
    openvpn_remote_host: str | None
    openvpn_remote_port: int | None
