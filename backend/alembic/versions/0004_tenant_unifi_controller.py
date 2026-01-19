"""Tenant-level UniFi controller

Revision ID: 0004_tenant_unifi_controller
Revises: 0003_add_tos_only
Create Date: 2026-01-19 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0004_tenant_unifi_controller"
down_revision = "0003_add_tos_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("unifi_base_url", sa.String(length=255), nullable=True))
    op.add_column("tenants", sa.Column("unifi_api_key_ref", sa.String(length=255), nullable=True))
    op.alter_column("sites", "unifi_base_url", existing_type=sa.String(length=255), nullable=True)
    op.alter_column("sites", "unifi_api_key_ref", existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    op.alter_column("sites", "unifi_api_key_ref", existing_type=sa.String(length=255), nullable=False)
    op.alter_column("sites", "unifi_base_url", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("tenants", "unifi_api_key_ref")
    op.drop_column("tenants", "unifi_base_url")
