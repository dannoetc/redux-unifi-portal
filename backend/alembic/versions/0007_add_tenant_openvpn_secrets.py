"""Add tenant OpenVPN secrets storage

Revision ID: 0007_add_tenant_openvpn_secrets
Revises: 0006_add_tenant_openvpn_fields
Create Date: 2026-01-22 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0007_add_tenant_openvpn_secrets"
down_revision = "0006_add_tenant_openvpn_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "tenant_openvpn_secrets",
        sa.Column("tenant_id", sa.Uuid(as_uuid=True), nullable=False),
        sa.Column("profile_template_encrypted", sa.LargeBinary(), nullable=False),
        sa.Column("ca_bundle_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("auth_blob_encrypted", sa.LargeBinary(), nullable=True),
        sa.Column("encryption_version", sa.String(length=32), nullable=False, server_default="v1"),
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
        sa.PrimaryKeyConstraint("tenant_id"),
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenant_openvpn_secrets_tenant_id "
        "ON tenant_openvpn_secrets (tenant_id)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_tenant_openvpn_secrets_tenant_id")
    op.drop_table("tenant_openvpn_secrets")
