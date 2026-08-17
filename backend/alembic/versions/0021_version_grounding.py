"""version_grounding — stored LLM claim-grounding report per trust version (P1-4)."""
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE version_grounding (
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
    op.execute("DROP TABLE version_grounding")
