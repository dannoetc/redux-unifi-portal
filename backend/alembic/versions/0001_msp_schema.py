"""MSP-first schema

Revision ID: 0001_msp_schema
Revises: 
Create Date: 2026-01-15 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0001_msp_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    tenant_status = sa.Enum("ACTIVE", "SUSPENDED", name="tenant_status")
    admin_role = sa.Enum("TENANT_ADMIN", "TENANT_VIEWER", name="admin_role")
    portal_session_status = sa.Enum(
        "STARTED",
        "AUTHED",
        "AUTHORIZED",
        "FAILED",
        "EXPIRED",
        name="portal_session_status",
    )
    auth_method = sa.Enum("VOUCHER", "EMAIL_OTP", "OIDC", name="auth_method")
    auth_result = sa.Enum("SUCCESS", "FAIL", name="auth_result")

    bind = op.get_bind()
    tenant_status.create(bind, checkfirst=True)
    admin_role.create(bind, checkfirst=True)
    portal_session_status.create(bind, checkfirst=True)
    auth_method.create(bind, checkfirst=True)
    auth_result.create(bind, checkfirst=True)

    op.create_table(
        "tenants",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False, unique=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("status", tenant_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "admin_users",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_superadmin", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_admin_users_email", "admin_users", ["email"], unique=False)

    op.create_table(
        "admin_memberships",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("admin_user_id", sa.Uuid(), sa.ForeignKey("admin_users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", admin_role, nullable=False),
        sa.UniqueConstraint("admin_user_id", "tenant_id", name="uq_admin_memberships_user_tenant"),
    )
    op.create_index("ix_admin_memberships_tenant", "admin_memberships", ["tenant_id"], unique=False)

    op.create_table(
        "sites",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("unifi_base_url", sa.String(length=255), nullable=False),
        sa.Column("unifi_site_id", sa.String(length=128), nullable=False),
        sa.Column("unifi_api_key_ref", sa.String(length=255), nullable=False),
        sa.Column("default_time_limit_minutes", sa.Integer(), nullable=False),
        sa.Column("default_data_limit_mb", sa.Integer(), nullable=True),
        sa.Column("default_rx_kbps", sa.Integer(), nullable=True),
        sa.Column("default_tx_kbps", sa.Integer(), nullable=True),
        sa.Column("logo_url", sa.String(length=512), nullable=True),
        sa.Column("primary_color", sa.String(length=32), nullable=True),
        sa.Column("terms_html", sa.Text(), nullable=True),
        sa.Column("support_contact", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "slug", name="uq_sites_tenant_slug"),
    )
    op.create_index("ix_sites_tenant", "sites", ["tenant_id"], unique=False)

    op.create_table(
        "portal_sessions",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.Uuid(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("client_mac", sa.String(length=32), nullable=False),
        sa.Column("ap_mac", sa.String(length=32), nullable=True),
        sa.Column("ssid", sa.String(length=128), nullable=True),
        sa.Column("orig_url", sa.String(length=2048), nullable=True),
        sa.Column("ip", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("status", portal_session_status, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_portal_sessions_site_client",
        "portal_sessions",
        ["site_id", "client_mac"],
        unique=False,
    )
    op.create_index(
        "ix_portal_sessions_tenant_created",
        "portal_sessions",
        ["tenant_id", "created_at"],
        unique=False,
    )
    op.create_index(
        "ix_portal_sessions_site_created",
        "portal_sessions",
        ["site_id", "created_at"],
        unique=False,
    )

    op.create_table(
        "guest_identities",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("oidc_sub", sa.String(length=255), nullable=True),
        sa.Column("display_name", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("tenant_id", "email", name="uq_guest_identities_tenant_email"),
        sa.UniqueConstraint("tenant_id", "oidc_sub", name="uq_guest_identities_tenant_oidc_sub"),
    )
    op.create_index("ix_guest_identities_tenant", "guest_identities", ["tenant_id"], unique=False)

    op.create_table(
        "auth_events",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.Uuid(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "portal_session_id",
            sa.Uuid(),
            sa.ForeignKey("portal_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "guest_identity_id",
            sa.Uuid(),
            sa.ForeignKey("guest_identities.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("method", auth_method, nullable=False),
        sa.Column("result", auth_result, nullable=False),
        sa.Column("reason", sa.String(length=255), nullable=True),
        sa.Column("unifi_client_id", sa.String(length=128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_auth_events_tenant_created", "auth_events", ["tenant_id", "created_at"], unique=False)
    op.create_index("ix_auth_events_site_created", "auth_events", ["site_id", "created_at"], unique=False)
    op.create_index("ix_auth_events_portal_session", "auth_events", ["portal_session_id"], unique=False)
    op.create_index("ix_auth_events_guest_identity", "auth_events", ["guest_identity_id"], unique=False)

    op.create_table(
        "voucher_batches",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.Uuid(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("max_uses_per_code", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_voucher_batches_tenant_site", "voucher_batches", ["tenant_id", "site_id"], unique=False)

    op.create_table(
        "vouchers",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("batch_id", sa.Uuid(), sa.ForeignKey("voucher_batches.id", ondelete="CASCADE"), nullable=False),
        sa.Column("code", sa.String(length=64), nullable=False),
        sa.Column("uses", sa.Integer(), server_default="0", nullable=False),
        sa.Column("disabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("code", name="uq_vouchers_code"),
    )
    op.create_index("ix_vouchers_batch", "vouchers", ["batch_id"], unique=False)

    op.create_table(
        "voucher_redemptions",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("site_id", sa.Uuid(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("voucher_id", sa.Uuid(), sa.ForeignKey("vouchers.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "portal_session_id",
            sa.Uuid(),
            sa.ForeignKey("portal_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("client_mac", sa.String(length=32), nullable=False),
        sa.Column("redeemed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index(
        "ix_voucher_redemptions_tenant_site",
        "voucher_redemptions",
        ["tenant_id", "site_id"],
        unique=False,
    )
    op.create_index(
        "ix_voucher_redemptions_voucher",
        "voucher_redemptions",
        ["voucher_id"],
        unique=False,
    )
    op.create_index(
        "ix_voucher_redemptions_portal_session",
        "voucher_redemptions",
        ["portal_session_id"],
        unique=False,
    )

    op.create_table(
        "oidc_providers",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("tenant_id", sa.Uuid(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False),
        sa.Column("issuer", sa.String(length=255), nullable=False),
        sa.Column("client_id", sa.String(length=255), nullable=False),
        sa.Column("client_secret_ref", sa.String(length=255), nullable=False),
        sa.Column("scopes", sa.String(length=255), nullable=False),
        sa.UniqueConstraint("tenant_id", "issuer", name="uq_oidc_providers_tenant_issuer"),
    )
    op.create_index("ix_oidc_providers_tenant", "oidc_providers", ["tenant_id"], unique=False)

    op.create_table(
        "site_oidc_settings",
        sa.Column("id", sa.Uuid(), primary_key=True, nullable=False),
        sa.Column("site_id", sa.Uuid(), sa.ForeignKey("sites.id", ondelete="CASCADE"), nullable=False),
        sa.Column("provider_id", sa.Uuid(), sa.ForeignKey("oidc_providers.id", ondelete="CASCADE"), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("allowed_domains", sa.String(length=255), nullable=True),
        sa.UniqueConstraint("site_id", "provider_id", name="uq_site_oidc_settings_site_provider"),
    )
    op.create_index("ix_site_oidc_settings_site", "site_oidc_settings", ["site_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_site_oidc_settings_site", table_name="site_oidc_settings")
    op.drop_table("site_oidc_settings")
    op.drop_index("ix_oidc_providers_tenant", table_name="oidc_providers")
    op.drop_table("oidc_providers")
    op.drop_index("ix_voucher_redemptions_portal_session", table_name="voucher_redemptions")
    op.drop_index("ix_voucher_redemptions_voucher", table_name="voucher_redemptions")
    op.drop_index("ix_voucher_redemptions_tenant_site", table_name="voucher_redemptions")
    op.drop_table("voucher_redemptions")
    op.drop_index("ix_vouchers_batch", table_name="vouchers")
    op.drop_table("vouchers")
    op.drop_index("ix_voucher_batches_tenant_site", table_name="voucher_batches")
    op.drop_table("voucher_batches")
    op.drop_index("ix_auth_events_guest_identity", table_name="auth_events")
    op.drop_index("ix_auth_events_portal_session", table_name="auth_events")
    op.drop_index("ix_auth_events_site_created", table_name="auth_events")
    op.drop_index("ix_auth_events_tenant_created", table_name="auth_events")
    op.drop_table("auth_events")
    op.drop_index("ix_guest_identities_tenant", table_name="guest_identities")
    op.drop_table("guest_identities")
    op.drop_index("ix_portal_sessions_site_created", table_name="portal_sessions")
    op.drop_index("ix_portal_sessions_tenant_created", table_name="portal_sessions")
    op.drop_index("ix_portal_sessions_site_client", table_name="portal_sessions")
    op.drop_table("portal_sessions")
    op.drop_index("ix_sites_tenant", table_name="sites")
    op.drop_table("sites")
    op.drop_index("ix_admin_memberships_tenant", table_name="admin_memberships")
    op.drop_table("admin_memberships")
    op.drop_index("ix_admin_users_email", table_name="admin_users")
    op.drop_table("admin_users")
    op.drop_table("tenants")

    bind = op.get_bind()
    sa.Enum(name="auth_result").drop(bind, checkfirst=True)
    sa.Enum(name="auth_method").drop(bind, checkfirst=True)
    sa.Enum(name="portal_session_status").drop(bind, checkfirst=True)
    sa.Enum(name="admin_role").drop(bind, checkfirst=True)
    sa.Enum(name="tenant_status").drop(bind, checkfirst=True)
