"""Create common_projects table for Common Project Repository

Revision ID: 0037
Revises: 0036
Create Date: 2026-10-03 10:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "common_projects",
        sa.Column("id", sa.String, nullable=False),
        sa.Column("author_id", sa.String, nullable=False),
        sa.Column("title", sa.String, nullable=False),
        sa.Column("description", sa.Text, nullable=True),
        sa.Column("project_data", postgresql.JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["author_id"], ["accounts.sub"]),
        sa.Index("ix_common_projects_author_id", "author_id"),
        sa.Index("ix_common_projects_created_at", "created_at"),
    )


def downgrade() -> None:
    op.drop_table("common_projects")
