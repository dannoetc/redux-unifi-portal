"""Add tenant roaming and OpenVPN fields

Revision ID: 0006_add_tenant_openvpn_fields
Revises: 0005_merge_heads
Create Date: 2026-01-21 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0006_add_tenant_openvpn_fields"
down_revision = "0005_merge_heads"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("is_roaming", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column(
        "tenants",
        sa.Column("openvpn_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
    )
    op.add_column("tenants", sa.Column("openvpn_profile_ref", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("openvpn_auth_ref", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("openvpn_ca_ref", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("openvpn_remote_host", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("openvpn_remote_port", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "openvpn_remote_port")
    op.drop_column("tenants", "openvpn_remote_host")
    op.drop_column("tenants", "openvpn_ca_ref")
    op.drop_column("tenants", "openvpn_auth_ref")
    op.drop_column("tenants", "openvpn_profile_ref")
    op.drop_column("tenants", "openvpn_enabled")
    op.drop_column("tenants", "is_roaming")
