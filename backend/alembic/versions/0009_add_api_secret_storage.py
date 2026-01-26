"""Add encrypted API secret storage

Revision ID: 0009_add_api_secret_storage
Revises: 0008_openvpn_client_profiles
Create Date: 2026-01-27 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0009_add_api_secret_storage"
down_revision = "0008_openvpn_client_profiles"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("unifi_api_key_encrypted", sa.LargeBinary(), nullable=True))
    op.add_column("sites", sa.Column("unifi_api_key_encrypted", sa.LargeBinary(), nullable=True))
    op.add_column("oidc_providers", sa.Column("client_secret_encrypted", sa.LargeBinary(), nullable=True))
    op.alter_column("oidc_providers", "client_secret_ref", existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    op.alter_column("oidc_providers", "client_secret_ref", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("oidc_providers", "client_secret_encrypted")
    op.drop_column("sites", "unifi_api_key_encrypted")
    op.drop_column("tenants", "unifi_api_key_encrypted")
