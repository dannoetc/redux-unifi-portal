from __future__ import annotations

from pydantic import BaseModel


class DashboardOverview(BaseModel):
    sessions_started: int
    sessions_authorized: int
    sessions_failed: int
    auth_attempts: int
    auth_success: int
    auth_fail: int
    success_rate: float
    voucher_redemptions: int
    tos_clicks: int


class DashboardMethodBreakdown(BaseModel):
    method: str
    attempts: int
    success: int
    fail: int
    success_rate: float


class DashboardDailyPoint(BaseModel):
    day: str
    sessions_started: int
    sessions_authorized: int
    sessions_failed: int
    auth_attempts: int
    auth_success: int
    auth_fail: int
    voucher_redemptions: int
    tos_clicks: int
    otp_success: int
    oidc_success: int


class DashboardSiteRollup(BaseModel):
    site_id: str
    site_name: str
    sessions_started: int
    auth_attempts: int
    auth_success: int
    voucher_redemptions: int
    tos_clicks: int
    success_rate: float


class DashboardSiteOption(BaseModel):
    id: str
    display_name: str


class DashboardSummaryResponse(BaseModel):
    period_days: int
    site_id: str | None
    window_start: str
    window_end: str
    generated_at: str
    overview: DashboardOverview
    methods: list[DashboardMethodBreakdown]
    daily: list[DashboardDailyPoint]
    sites: list[DashboardSiteRollup]
    site_options: list[DashboardSiteOption]
