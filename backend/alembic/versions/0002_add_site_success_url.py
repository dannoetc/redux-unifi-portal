"""Add site success_url

Revision ID: 0002_add_site_success_url
Revises: 0001_msp_schema
Create Date: 2026-01-15 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0002_add_site_success_url"
down_revision = "0001_msp_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("sites", sa.Column("success_url", sa.String(length=512), nullable=True))


def downgrade() -> None:
    op.drop_column("sites", "success_url")
