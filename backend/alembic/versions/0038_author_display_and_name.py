"""Add author display name and common_projects author_name snapshot

Revision ID: 0038
Revises: 0037
Create Date: 2026-10-03 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add display_name to account table (nullable — users must set explicitly)
    op.add_column("account", sa.Column("display_name", sa.String, nullable=True))

    # Add author_name snapshot + moderation fields to common_projects
    op.add_column("common_projects", sa.Column("author_name", sa.String, nullable=True))
    op.add_column("common_projects", sa.Column("taken_down_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("common_projects", sa.Column("taken_down_reason", sa.Text, nullable=True))


def downgrade() -> None:
    op.drop_column("common_projects", "taken_down_reason")
    op.drop_column("common_projects", "taken_down_at")
    op.drop_column("common_projects", "author_name")
    op.drop_column("account", "display_name")
