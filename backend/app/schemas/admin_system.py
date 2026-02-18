from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field


class SmtpSettingsResponse(BaseModel):
    host: str
    port: int
    username: str
    from_email: str
    from_name: str
    password_configured: bool


class SystemPreferencesResponse(BaseModel):
    compact_tables: bool = False
    show_setup_checklists: bool = True


class SystemSettingsResponse(BaseModel):
    smtp: SmtpSettingsResponse
    preferences: SystemPreferencesResponse


class SmtpSettingsUpdateRequest(BaseModel):
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    username: str = ""
    from_email: EmailStr
    from_name: str = Field(min_length=1, max_length=255)
    password: str | None = None
    clear_password: bool = False


class SystemPreferencesUpdateRequest(BaseModel):
    compact_tables: bool = False
    show_setup_checklists: bool = True


class SmtpTestRequest(BaseModel):
    to_email: EmailStr
