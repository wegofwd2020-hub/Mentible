"""feedback.section_index — anchor a comment to one section of an (immutable) version (P0-2 slice A)"""

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable → existing rows stay whole-version comments; additive + backward-compatible.
    op.execute("ALTER TABLE feedback ADD COLUMN section_index integer NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE feedback DROP COLUMN section_index")
