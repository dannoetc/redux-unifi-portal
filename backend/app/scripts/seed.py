from __future__ import annotations

import os
import uuid

from sqlalchemy import select

from app.db import SessionLocal
from app.models import AdminMembership, AdminRole, AdminUser, Site, Tenant, TenantStatus
from app.security import hash_password


def _split_env(name: str) -> list[str]:
    raw = os.environ.get(name, "")
    return [item.strip() for item in raw.split(",") if item.strip()]


def main() -> None:
    super_email = os.environ.get("SUPERADMIN_EMAIL")
    super_password = os.environ.get("SUPERADMIN_PASSWORD")
    tenant_slug = os.environ.get("TENANT_SLUG")
    tenant_name = os.environ.get("TENANT_NAME", "Sample Tenant")
    site_slugs = _split_env("SITE_SLUGS")

    if not super_email or not super_password:
        raise SystemExit("SUPERADMIN_EMAIL and SUPERADMIN_PASSWORD are required.")
    if not tenant_slug:
        raise SystemExit("TENANT_SLUG is required.")
    if not site_slugs:
        raise SystemExit("SITE_SLUGS is required (comma-separated).")

    site_display_names = _split_env("SITE_DISPLAY_NAMES")
    site_unifi_ids = _split_env("SITE_UNIFI_SITE_IDS")

    unifi_base_url = os.environ.get("UNIFI_BASE_URL", "https://unifi.local")
    unifi_api_key_ref = os.environ.get("UNIFI_API_KEY_REF", "dev-unifi-key")

    default_time_limit = int(os.environ.get("DEFAULT_TIME_LIMIT_MINUTES", "60"))
    default_data_limit = os.environ.get("DEFAULT_DATA_LIMIT_MB")
    default_rx_kbps = os.environ.get("DEFAULT_RX_KBPS")
    default_tx_kbps = os.environ.get("DEFAULT_TX_KBPS")

    with SessionLocal() as session:
        admin = session.execute(
            select(AdminUser).where(AdminUser.email == super_email)
        ).scalar_one_or_none()
        if not admin:
            admin = AdminUser(
                id=uuid.uuid4(),
                email=super_email,
                password_hash=hash_password(super_password),
                is_superadmin=True,
            )
            session.add(admin)
            session.flush()

        tenant = session.execute(select(Tenant).where(Tenant.slug == tenant_slug)).scalar_one_or_none()
        if not tenant:
            tenant = Tenant(
                id=uuid.uuid4(),
                slug=tenant_slug,
                name=tenant_name,
                status=TenantStatus.ACTIVE,
            )
            session.add(tenant)
            session.flush()

        membership = session.execute(
            select(AdminMembership).where(
                AdminMembership.admin_user_id == admin.id,
                AdminMembership.tenant_id == tenant.id,
            )
        ).scalar_one_or_none()
        if not membership:
            membership = AdminMembership(
                id=uuid.uuid4(),
                admin_user_id=admin.id,
                tenant_id=tenant.id,
                role=AdminRole.TENANT_ADMIN,
            )
            session.add(membership)

        for index, slug in enumerate(site_slugs):
            display_name = (
                site_display_names[index] if index < len(site_display_names) else slug
            )
            site_id = site_unifi_ids[index] if index < len(site_unifi_ids) else slug
            existing_site = session.execute(
                select(Site).where(Site.tenant_id == tenant.id, Site.slug == slug)
            ).scalar_one_or_none()
            if existing_site:
                continue
            site = Site(
                id=uuid.uuid4(),
                tenant_id=tenant.id,
                slug=slug,
                display_name=display_name,
                enabled=True,
                unifi_base_url=unifi_base_url,
                unifi_site_id=site_id,
                unifi_api_key_ref=unifi_api_key_ref,
                default_time_limit_minutes=default_time_limit,
                default_data_limit_mb=int(default_data_limit) if default_data_limit else None,
                default_rx_kbps=int(default_rx_kbps) if default_rx_kbps else None,
                default_tx_kbps=int(default_tx_kbps) if default_tx_kbps else None,
            )
            session.add(site)

        session.commit()


if __name__ == "__main__":
    main()
