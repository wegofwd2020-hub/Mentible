"""version_originality — stored LLM source-overlap originality report per
trust version (B3 Part A). Same shape as version_grounding (0021): PK
(version_id, version_kind), a jsonb report, the model that produced it, and
cited_content_hash for the read-time stale check."""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE version_originality (
            version_id uuid NOT NULL,
            version_kind text NOT NULL CHECK (version_kind IN ('artifact','topic')),
            report jsonb NOT NULL,
            model text NOT NULL,
            checked_at timestamptz NOT NULL DEFAULT now(),
            cited_content_hash text NOT NULL,
            PRIMARY KEY (version_id, version_kind)
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE version_originality")
