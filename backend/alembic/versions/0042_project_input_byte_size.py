"""Record the size of uploaded audio so the Free storage cap can sum it.

Uploads (kind='upload') now store `byte_size`. Rows created before this migration have
NULL and count as 0, so the cap can under-count pre-existing uploads. Accepted: uploads
are new in the Tamil STT capture arc and the cap is a disk-safety guard, not billing.

Revision ID: 0042
Revises: 0041
"""

from alembic import op

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE project_input ADD COLUMN byte_size bigint")


def downgrade() -> None:
    op.execute("ALTER TABLE project_input DROP COLUMN IF EXISTS byte_size")
