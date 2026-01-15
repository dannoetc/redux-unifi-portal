from __future__ import annotations

from pydantic import BaseModel


class GuestConfigResponse(BaseModel):
    logo_url: str | None
    primary_color: str | None
    terms_html: str | None
    support_contact: str | None
    display_name: str
    methods: list[str]
    policy: dict


class GuestSessionInitRequest(BaseModel):
    ap: str | None = None
    id: str
    t: str | None = None
    url: str | None = None
    ssid: str | None = None
    user_agent: str | None = None


class GuestVoucherRequest(BaseModel):
    portal_session_id: str
    code: str


class GuestOtpStartRequest(BaseModel):
    portal_session_id: str
    email: str


class GuestOtpVerifyRequest(BaseModel):
    portal_session_id: str
    email: str
    code: str
