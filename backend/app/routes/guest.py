from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()

@router.get("/{tenant_slug}/{site_slug}/config")
def get_site_config(tenant_slug: str, site_slug: str) -> dict:
    # TODO: Return branding + enabled methods + policy defaults
    return {"tenant": tenant_slug, "site": site_slug, "methods": ["voucher", "email_otp", "oidc"]}
