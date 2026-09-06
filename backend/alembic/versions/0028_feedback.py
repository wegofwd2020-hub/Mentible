"""feedback capture table (in-app feedback → JSON store + support email)"""

from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE app_feedback (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            -- SET NULL (not CASCADE): feedback is analysis data that must outlive a
            -- deleted account; name/email are copied into columns so it stays complete.
            account_id  uuid REFERENCES account(id) ON DELETE SET NULL,
            name        text NOT NULL,
            email       text NOT NULL,
            app         text NOT NULL DEFAULT 'mentible',
            page        text NOT NULL,
            payload     jsonb NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX app_feedback_created_at_idx ON app_feedback (created_at DESC)")


def downgrade() -> None:
    op.execute("DROP TABLE app_feedback")
