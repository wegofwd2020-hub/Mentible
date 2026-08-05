"""approval.action (approve | withdraw) — append-only approve/unapprove toggle (slice 2)

Adds an `action` column to the append-only `approval` log so an approval can be
withdrawn without deleting trust evidence: withdrawing appends a new row with
action='withdraw'. A version is validated IFF its LATEST approval row is an
'approve'. Existing rows default to 'approve', preserving current validation.
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE approval ADD COLUMN action text NOT NULL DEFAULT 'approve'")
    op.execute(
        "ALTER TABLE approval ADD CONSTRAINT approval_action_check "
        "CHECK (action IN ('approve','withdraw'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE approval DROP CONSTRAINT approval_action_check")
    op.execute("ALTER TABLE approval DROP COLUMN action")
