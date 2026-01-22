from __future__ import annotations

import os
import re
import secrets
import shlex
import subprocess
import string

from cryptography.fernet import Fernet, InvalidToken

from app.models.openvpn_secret import TenantOpenvpnSecret
from app.models.tenant import Tenant
from app.settings import settings


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


def encrypt_openvpn_secret(value: str) -> bytes:
    fernet = _get_fernet()
    return fernet.encrypt(value.encode("utf-8"))


def decrypt_openvpn_secret(value: bytes) -> str:
    fernet = _get_fernet()
    try:
        decrypted = fernet.decrypt(value)
    except InvalidToken as exc:
        raise OpenVpnError(
            "OPENVPN_SECRET_DECRYPT_FAILED",
            "OpenVPN secret could not be decrypted.",
        ) from exc
    return decrypted.decode("utf-8")


def resolve_openvpn_profile_template(
    *,
    openvpn_profile_template: str | None,
    openvpn_profile_ref: str | None,
    openvpn_secret: TenantOpenvpnSecret | None,
) -> str | None:
    if openvpn_profile_template:
        return openvpn_profile_template
    if openvpn_secret is not None:
        return decrypt_openvpn_secret(openvpn_secret.profile_template_encrypted)
    if openvpn_profile_ref:
        return resolve_openvpn_secret(openvpn_profile_ref)
    # Fallback to default template
    return settings.OPENVPN_DEFAULT_TEMPLATE


def resolve_openvpn_ca_bundle(
    *,
    openvpn_ca_bundle: str | None,
    openvpn_ca_ref: str | None,
    openvpn_secret: TenantOpenvpnSecret | None,
) -> str | None:
    if openvpn_ca_bundle:
        return openvpn_ca_bundle
    if openvpn_secret is not None and openvpn_secret.ca_bundle_encrypted:
        return decrypt_openvpn_secret(openvpn_secret.ca_bundle_encrypted)
    if openvpn_ca_ref:
        return resolve_openvpn_secret(openvpn_ca_ref)
    return None


def resolve_openvpn_auth_blob(
    *,
    openvpn_auth_blob: str | None,
    openvpn_auth_ref: str | None,
    openvpn_secret: TenantOpenvpnSecret | None,
) -> str | None:
    if openvpn_auth_blob:
        return openvpn_auth_blob
    if openvpn_secret is not None and openvpn_secret.auth_blob_encrypted:
        return decrypt_openvpn_secret(openvpn_secret.auth_blob_encrypted)
    if openvpn_auth_ref:
        return resolve_openvpn_secret(openvpn_auth_ref)
    return None


def build_openvpn_profile(tenant: Tenant) -> str:
    """Build a tenant-specific OpenVPN profile from stored secrets or env refs."""
    profile = resolve_openvpn_profile_template(
        openvpn_profile_template=None,
        openvpn_profile_ref=tenant.openvpn_profile_ref,
        openvpn_secret=tenant.openvpn_secret,
    )
    if not profile:
        raise OpenVpnError("OPENVPN_PROFILE_MISSING", "OpenVPN profile template is required.")
    profile = _apply_placeholders(profile, tenant)
    profile = _ensure_remote(profile, tenant)

    ca_bundle = resolve_openvpn_ca_bundle(
        openvpn_ca_bundle=None,
        openvpn_ca_ref=tenant.openvpn_ca_ref,
        openvpn_secret=tenant.openvpn_secret,
    )
    if ca_bundle and "<ca>" not in profile:
        ca_bundle = ca_bundle.strip()
        profile = f"{profile.rstrip()}\n<ca>\n{ca_bundle}\n</ca>\n"

    auth_payload = resolve_openvpn_auth_blob(
        openvpn_auth_blob=None,
        openvpn_auth_ref=tenant.openvpn_auth_ref,
        openvpn_secret=tenant.openvpn_secret,
    )
    if auth_payload:
        auth_payload = auth_payload.strip()
        profile = _ensure_auth(profile, auth_payload)

    return profile.rstrip() + "\n"


def generate_openvpn_client_profile(client_name: str) -> str:
    cleaned = client_name.strip()
    if not cleaned:
        raise OpenVpnError("OPENVPN_INVALID_CLIENT_NAME", "Client name is required.")
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,63}", cleaned):
        raise OpenVpnError(
            "OPENVPN_INVALID_CLIENT_NAME",
            "Client name must use letters, numbers, dots, dashes, or underscores.",
        )

    prefix = _resolve_openvpn_command_prefix()
    
    _run_openvpn_command(
        prefix + ["easyrsa", "build-client-full", cleaned, "nopass"],
        "OpenVPN client certificate generation failed.",
    )
    profile = _run_openvpn_command(
        prefix + ["ovpn_getclient", cleaned],
        "OpenVPN profile export failed.",
        capture_output=True,
    )
    if not profile.strip():
        raise OpenVpnError("OPENVPN_GENERATION_FAILED", "OpenVPN profile generation failed.")
    return sanitize_openvpn_profile(profile)


def sanitize_openvpn_profile(profile: str) -> str:
    sanitized_lines = []
    for line in profile.splitlines():
        if re.search(r"^\s*redirect-gateway\b", line, flags=re.IGNORECASE):
            continue
        if re.search(r"^\s*push\s+\"?redirect-gateway\b", line, flags=re.IGNORECASE):
            continue
        sanitized_lines.append(line)
    return "\n".join(sanitized_lines).rstrip() + "\n"


def _apply_placeholders(profile: str, tenant: Tenant) -> str:
    replacements = {
        "{{REMOTE_HOST}}": tenant.openvpn_remote_host or "",
        "{{REMOTE_PORT}}": str(tenant.openvpn_remote_port or ""),
    }
    for token, value in replacements.items():
        profile = profile.replace(token, value)
    return profile


def profile_requires_remote_settings(profile: str) -> bool:
    if _profile_uses_remote_placeholders(profile):
        return True
    return not _profile_has_remote_line(profile)


def _profile_uses_remote_placeholders(profile: str) -> bool:
    return "{{REMOTE_HOST}}" in profile or "{{REMOTE_PORT}}" in profile


def _profile_has_remote_line(profile: str) -> bool:
    return re.search(r"^remote\\s+", profile, flags=re.MULTILINE) is not None


def _ensure_remote(profile: str, tenant: Tenant) -> str:
    if _profile_has_remote_line(profile):
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


def _get_fernet() -> Fernet:
    key = settings.OPENVPN_ENCRYPTION_KEY
    if not key:
        raise OpenVpnError(
            "OPENVPN_ENCRYPTION_KEY_MISSING",
            "OpenVPN encryption key is not configured.",
        )
    try:
        return Fernet(key.encode("utf-8"))
    except (ValueError, TypeError) as exc:
        raise OpenVpnError(
            "OPENVPN_ENCRYPTION_KEY_INVALID",
            "OpenVPN encryption key is invalid.",
        ) from exc


def _resolve_openvpn_command_prefix() -> list[str]:
    prefix = settings.OPENVPN_GENERATE_COMMAND_PREFIX
    if not prefix:
        raise OpenVpnError(
            "OPENVPN_GENERATION_FAILED",
            "OpenVPN generation command prefix is not configured.",
        )
    return shlex.split(prefix)


def _run_openvpn_command(
    command: list[str],
    message: str,
    *,
    capture_output: bool = False,
) -> str:
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError as exc:
        raise OpenVpnError("OPENVPN_GENERATION_FAILED", message) from exc

    if result.returncode != 0:
        raise OpenVpnError("OPENVPN_GENERATION_FAILED", message)

    if capture_output:
        return (result.stdout or "").strip("\n") + "\n" if result.stdout is not None else ""
    return ""
