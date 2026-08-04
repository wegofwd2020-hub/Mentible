"""artifact.format += essay (drafts multi-format picker, slice 1)"""

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

_FORMATS = "'book','guide','learning_module','podcast','youtube','reel','linkedin','x_thread'"


def upgrade() -> None:
    op.execute("ALTER TABLE artifact DROP CONSTRAINT artifact_format_check")
    op.execute(
        f"ALTER TABLE artifact ADD CONSTRAINT artifact_format_check "
        f"CHECK (format IN ({_FORMATS},'essay'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE artifact DROP CONSTRAINT artifact_format_check")
    op.execute(
        f"ALTER TABLE artifact ADD CONSTRAINT artifact_format_check CHECK (format IN ({_FORMATS}))"
    )
