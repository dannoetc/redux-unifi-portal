from __future__ import annotations

from pydantic import BaseModel


class MethodDailyTrendRow(BaseModel):
    day: str
    method: str
    attempts: int
    success: int
    fail: int
    success_rate: float


class MethodDailyTrendResponse(BaseModel):
    period_days: int
    site_id: str | None
    method: str | None
    window_start: str
    window_end: str
    generated_at: str
    rows: list[MethodDailyTrendRow]


class SiteComparisonRow(BaseModel):
    site_id: str
    site_name: str
    auth_attempts: int
    auth_success: int
    auth_fail: int
    success_rate: float
    voucher_redemptions: int
    tos_clicks: int


class SiteComparisonResponse(BaseModel):
    period_days: int
    site_id: str | None
    method: str | None
    window_start: str
    window_end: str
    generated_at: str
    rows: list[SiteComparisonRow]
