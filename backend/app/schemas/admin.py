from __future__ import annotations

from pydantic import BaseModel


class AdminLoginRequest(BaseModel):
    email: str
    password: str
