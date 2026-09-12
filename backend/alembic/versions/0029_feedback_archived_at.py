"""feedback archive: soft-archive column + partial index for the active list"""

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Soft-archive marker. NULL = active (the default admin view); a timestamp =
    # archived. Hard delete removes the row outright; this column is the
    # reversible path that keeps the analysis data.
    op.execute("ALTER TABLE app_feedback ADD COLUMN archived_at timestamptz")
    # Partial index for the default "active" list (WHERE archived_at IS NULL),
    # matching the existing created_at DESC ordering.
    op.execute(
        "CREATE INDEX app_feedback_active_created_at_idx "
        "ON app_feedback (created_at DESC) WHERE archived_at IS NULL"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS app_feedback_active_created_at_idx")
    op.execute("ALTER TABLE app_feedback DROP COLUMN archived_at")
