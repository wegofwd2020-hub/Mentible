"""topic_feedback — revision-notes log for per-topic drafts (mirrors `feedback` at
the topic-version grain, per-topic panel S3)"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE topic_feedback (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            seq               bigserial,
            topic_version_id  uuid NOT NULL REFERENCES topic_version(id) ON DELETE CASCADE,
            author_kind       text NOT NULL CHECK (author_kind IN ('expert','operator')),
            author_name       text,
            body              text NOT NULL,
            recorded_by_sub   text NOT NULL,
            created_at        timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute("CREATE INDEX topic_feedback_version_idx ON topic_feedback (topic_version_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS topic_feedback")
