"""Add portal template version history table

Revision ID: 0011_site_template_versions
Revises: 0010_add_portal_template_modes
Create Date: 2026-02-17 00:00:00.000000
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op


revision = "0011_site_template_versions"
down_revision = "0010_add_portal_template_modes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "site_portal_template_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("tenant_id", sa.Uuid(), nullable=False),
        sa.Column("site_id", sa.Uuid(), nullable=False),
        sa.Column("portal_template_mode", sa.String(length=16), nullable=False),
        sa.Column("portal_template_html", sa.Text(), nullable=True),
        sa.Column("portal_template_theme", sa.JSON(), nullable=True),
        sa.Column("created_by_admin_user_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_admin_user_id"], ["admin_users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_site_portal_template_versions_site_created",
        "site_portal_template_versions",
        ["site_id", "created_at"],
    )
    op.create_index(
        "ix_site_portal_template_versions_tenant_created",
        "site_portal_template_versions",
        ["tenant_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_site_portal_template_versions_tenant_created", table_name="site_portal_template_versions")
    op.drop_index("ix_site_portal_template_versions_site_created", table_name="site_portal_template_versions")
    op.drop_table("site_portal_template_versions")
