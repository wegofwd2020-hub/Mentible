"""feedback.seq — deterministic chronological order for the revision-notes log (slice 3)

Same rationale as approval.seq (0012): feedback.created_at defaults to now()
(constant within a transaction) and id is a random uuid, so ORDER BY
created_at, id is not a strict insertion order. A monotonic bigserial `seq`
makes the per-version notes log deterministic regardless of transaction
boundaries.
"""

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE feedback ADD COLUMN seq bigserial")


def downgrade() -> None:
    op.execute("ALTER TABLE feedback DROP COLUMN seq")
