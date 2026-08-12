"""topic_version.generation_meta — provenance for per-topic drafts (Slice C/S2)"""

from alembic import op

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE topic_version ADD COLUMN generation_meta JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE topic_version DROP COLUMN generation_meta")
