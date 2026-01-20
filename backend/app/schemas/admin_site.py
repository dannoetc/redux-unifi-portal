from __future__ import annotations

from pydantic import BaseModel

class UnifiSiteDiscoveryResponse(BaseModel):
    id: str
    name: str | None
    internal_reference: str | None
    provisioned: bool
    suggested_slug: str | None


class SiteProvisionItem(BaseModel):
    unifi_site_id: str
    slug: str | None = None
    display_name: str | None = None
    enabled: bool = True


class SiteProvisionRequest(BaseModel):
    sites: list[SiteProvisionItem]


class SiteCreateRequest(BaseModel):
    display_name: str
    slug: str
    enabled: bool = True
    logo_url: str | None = None
    primary_color: str | None = None
    terms_html: str | None = None
    support_contact: str | None = None
    success_url: str | None = None
    enable_tos_only: bool = False
    unifi_base_url: str | None = None
    unifi_site_id: str
    unifi_api_key_ref: str | None = None
    default_time_limit_minutes: int = 60
    default_data_limit_mb: int | None = None
    default_rx_kbps: int | None = None
    default_tx_kbps: int | None = None


class SiteUpdateRequest(BaseModel):
    display_name: str | None = None
    slug: str | None = None
    enabled: bool | None = None
    logo_url: str | None = None
    primary_color: str | None = None
    terms_html: str | None = None
    support_contact: str | None = None
    success_url: str | None = None
    enable_tos_only: bool | None = None
    unifi_base_url: str | None = None
    unifi_site_id: str | None = None
    unifi_api_key_ref: str | None = None
    default_time_limit_minutes: int | None = None
    default_data_limit_mb: int | None = None
    default_rx_kbps: int | None = None
    default_tx_kbps: int | None = None


class SiteResponse(BaseModel):
    id: str
    slug: str
    display_name: str
    enabled: bool
    logo_url: str | None
    primary_color: str | None
    terms_html: str | None
    support_contact: str | None
    success_url: str | None
    enable_tos_only: bool
    unifi_base_url: str | None
    unifi_site_id: str
    unifi_api_key_ref: str | None
    default_time_limit_minutes: int
    default_data_limit_mb: int | None
    default_rx_kbps: int | None
    default_tx_kbps: int | None
