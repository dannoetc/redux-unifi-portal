from __future__ import annotations

from enum import Enum


class TenantStatus(str, Enum):
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"


class AdminRole(str, Enum):
    TENANT_ADMIN = "TENANT_ADMIN"
    TENANT_VIEWER = "TENANT_VIEWER"


class PortalSessionStatus(str, Enum):
    STARTED = "STARTED"
    AUTHED = "AUTHED"
    AUTHORIZED = "AUTHORIZED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"


class AuthMethod(str, Enum):
    VOUCHER = "VOUCHER"
    EMAIL_OTP = "EMAIL_OTP"
    OIDC = "OIDC"


class AuthResult(str, Enum):
    SUCCESS = "SUCCESS"
    FAIL = "FAIL"
