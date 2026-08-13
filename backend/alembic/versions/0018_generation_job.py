"""generation_job — durable progress for the fan-out 'generate full book' job (per-topic over the TOC)"""

from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE generation_job (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id        uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            kind              text NOT NULL DEFAULT 'book',
            status            text NOT NULL CHECK (status IN ('queued','running','done','halted','failed')),
            total             int  NOT NULL,
            done              int  NOT NULL DEFAULT 0,
            failed_topic_ids  text[] NOT NULL DEFAULT '{}',
            created_by_sub    text NOT NULL,
            created_at        timestamptz NOT NULL DEFAULT now(),
            updated_at        timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX generation_job_project_idx ON generation_job (project_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS generation_job")
