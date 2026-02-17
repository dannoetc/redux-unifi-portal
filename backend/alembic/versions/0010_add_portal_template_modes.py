"""Add portal template modes and theme options

Revision ID: 0010_add_portal_template_modes
Revises: 0009_add_api_secret_storage
Create Date: 2026-02-17 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0010_add_portal_template_modes"
down_revision = "0009_add_api_secret_storage"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "sites",
        sa.Column("portal_template_mode", sa.String(length=16), nullable=False, server_default="off"),
    )
    op.add_column("sites", sa.Column("portal_template_theme", sa.JSON(), nullable=True))

    op.execute(
        sa.text(
            """
            UPDATE sites
            SET portal_template_mode = 'replace'
            WHERE portal_template_enabled = true
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE sites
            SET portal_template_mode = 'embed'
            WHERE portal_template_enabled = true
              AND portal_template_html LIKE '%{{portal}}%'
            """
        )
    )


def downgrade() -> None:
    op.drop_column("sites", "portal_template_theme")
    op.drop_column("sites", "portal_template_mode")
