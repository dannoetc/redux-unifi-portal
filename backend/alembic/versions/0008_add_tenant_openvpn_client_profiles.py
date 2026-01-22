"""Add tenant OpenVPN client profiles

Revision ID: 0008_add_tenant_openvpn_client_profiles
Revises: 0007_add_tenant_openvpn_secrets
Create Date: 2026-01-22 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0008_add_tenant_openvpn_client_profiles"
down_revision = "0007_add_tenant_openvpn_secrets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_openvpn_client_profiles",
        sa.Column("id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("client_name", sa.String(length=255), nullable=False),
        sa.Column("profile_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["tenant_id"],
            ["tenants.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenant_openvpn_client_profiles_tenant_id "
        "ON tenant_openvpn_client_profiles (tenant_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenant_openvpn_client_profiles_client_name "
        "ON tenant_openvpn_client_profiles (client_name)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tenant_openvpn_client_profiles_client_name")
    op.execute("DROP INDEX IF EXISTS ix_tenant_openvpn_client_profiles_tenant_id")
    op.drop_table("tenant_openvpn_client_profiles")
