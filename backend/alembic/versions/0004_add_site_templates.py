"""Add site portal templates

Revision ID: 0004_add_site_templates
Revises: 0003_add_tos_only
Create Date: 2026-01-20 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0004_add_site_templates"
down_revision = "0003_add_tos_only"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "sites",
        "logo_url",
        existing_type=sa.String(length=512),
        type_=sa.Text(),
        existing_nullable=True,
    )
    op.add_column("sites", sa.Column("portal_template_html", sa.Text(), nullable=True))
    op.add_column(
        "sites",
        sa.Column("portal_template_enabled", sa.Boolean(), server_default="false", nullable=False),
    )


def downgrade() -> None:
    op.drop_column("sites", "portal_template_enabled")
    op.drop_column("sites", "portal_template_html")
    op.alter_column(
        "sites",
        "logo_url",
        existing_type=sa.Text(),
        type_=sa.String(length=512),
        existing_nullable=True,
    )
