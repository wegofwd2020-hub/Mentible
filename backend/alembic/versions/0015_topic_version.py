"""topic_version + topic_approval — per-topic drafts & validation (Slice C1)"""

from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE topic_version (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id       uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            topic_id         text NOT NULL,
            title            text NOT NULL,
            source_ids       jsonb NOT NULL DEFAULT '[]'::jsonb,
            content          jsonb NOT NULL,
            version_no       integer NOT NULL,
            created_by_sub   text NOT NULL,
            created_at       timestamptz NOT NULL DEFAULT now(),
            UNIQUE (project_id, topic_id, version_no)
        )
        """
    )
    op.execute(
        "CREATE INDEX topic_version_project_topic_idx "
        "ON topic_version (project_id, topic_id, version_no)"
    )
    op.execute(
        """
        CREATE TABLE topic_approval (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            topic_version_id  uuid NOT NULL REFERENCES topic_version(id) ON DELETE CASCADE,
            seq               bigserial,
            action            text NOT NULL CHECK (action IN ('approve','withdraw')),
            expert_name       text NOT NULL,
            expert_email      text,
            expert_role       text,
            approved_at       timestamptz NOT NULL,
            recorded_by_sub   text NOT NULL,
            note              text,
            recorded_via      text NOT NULL CHECK (recorded_via IN ('operator','expert_self')),
            recorded_at       timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX topic_approval_version_seq_idx ON topic_approval (topic_version_id, seq)"
    )


def downgrade() -> None:
    # Two separate op.execute() calls: the asyncpg driver's extended query
    # protocol rejects multiple statements in a single prepared execute
    # (unlike the psycopg2/offline path 0009's downgrade was written against).
    op.execute("DROP TABLE IF EXISTS topic_approval")
    op.execute("DROP TABLE IF EXISTS topic_version")
