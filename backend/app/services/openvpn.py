from __future__ import annotations

import os
import re

from app.models.tenant import Tenant


class OpenVpnError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def resolve_openvpn_secret(ref: str) -> str:
    """Resolve an OpenVPN secret from an environment variable reference."""
    value = os.environ.get(ref)
    if not value:
        raise OpenVpnError("OPENVPN_SECRET_MISSING", "OpenVPN secret is not configured.")
    return value


def build_openvpn_profile(tenant: Tenant) -> str:
    """Build a tenant-specific OpenVPN profile from env-stored templates."""
    if not tenant.openvpn_profile_ref:
        raise OpenVpnError("OPENVPN_PROFILE_MISSING", "OpenVPN profile template is required.")
    profile = resolve_openvpn_secret(tenant.openvpn_profile_ref)
    profile = _apply_placeholders(profile, tenant)
    profile = _ensure_remote(profile, tenant)

    if tenant.openvpn_ca_ref and "<ca>" not in profile:
        ca_bundle = resolve_openvpn_secret(tenant.openvpn_ca_ref).strip()
        profile = f"{profile.rstrip()}\n<ca>\n{ca_bundle}\n</ca>\n"

    if tenant.openvpn_auth_ref:
        auth_payload = resolve_openvpn_secret(tenant.openvpn_auth_ref).strip()
        profile = _ensure_auth(profile, auth_payload)

    return profile.rstrip() + "\n"


def _apply_placeholders(profile: str, tenant: Tenant) -> str:
    replacements = {
        "{{REMOTE_HOST}}": tenant.openvpn_remote_host or "",
        "{{REMOTE_PORT}}": str(tenant.openvpn_remote_port or ""),
    }
    for token, value in replacements.items():
        profile = profile.replace(token, value)
    return profile


def _ensure_remote(profile: str, tenant: Tenant) -> str:
    if re.search(r"^remote\\s+", profile, flags=re.MULTILINE):
        return profile
    if not tenant.openvpn_remote_host or not tenant.openvpn_remote_port:
        return profile
    return f"{profile.rstrip()}\nremote {tenant.openvpn_remote_host} {tenant.openvpn_remote_port}\n"


def _ensure_auth(profile: str, auth_payload: str) -> str:
    updated = profile
    if "auth-user-pass" not in updated:
        updated = f"{updated.rstrip()}\nauth-user-pass\n"
    if "<auth-user-pass>" not in updated:
        updated = f"{updated.rstrip()}\n<auth-user-pass>\n{auth_payload}\n</auth-user-pass>\n"
    return updated
