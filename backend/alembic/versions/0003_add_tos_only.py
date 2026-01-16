"""Add TOS-only guest auth

Revision ID: 0003_add_tos_only
Revises: 0002_add_site_success_url
Create Date: 2026-01-16 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0003_add_tos_only"
down_revision = "0002_add_site_success_url"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sites",
        sa.Column("enable_tos_only", sa.Boolean(), server_default="false", nullable=False),
    )
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TYPE auth_method ADD VALUE IF NOT EXISTS 'TOS_ONLY'")


def downgrade() -> None:
    op.drop_column("sites", "enable_tos_only")
