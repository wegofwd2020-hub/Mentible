"""Add system_config table for live runtime configuration."""

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "system_config",
        sa.Column("key", sa.String(128), primary_key=True),
        sa.Column("value", sa.String(1024), nullable=False),
        sa.Column(
            "type", sa.String(16), nullable=False, default="string"
        ),  # string, int, float, bool
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column("updated_by", sa.String(255), nullable=True),  # super-admin email/sub
    )
    op.create_index("ix_system_config_key", "system_config", ["key"])


def downgrade() -> None:
    op.drop_index("ix_system_config_key")
    op.drop_table("system_config")
