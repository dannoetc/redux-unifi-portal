"""Migration spacer (linearized history)

Revision ID: 0005_merge_heads
Revises: 0004_add_site_templates
Create Date: 2026-01-20 00:00:00.000000
"""

from __future__ import annotations

from alembic import op


revision = "0005_merge_heads"
down_revision = "0004_add_site_templates"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("SELECT 1")


def downgrade() -> None:
    op.execute("SELECT 1")
