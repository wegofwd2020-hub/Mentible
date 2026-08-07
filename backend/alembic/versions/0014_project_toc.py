"""project.toc — the Structure-phase outline (Slice B)"""

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE project ADD COLUMN toc jsonb")


def downgrade() -> None:
    op.execute("ALTER TABLE project DROP COLUMN toc")
