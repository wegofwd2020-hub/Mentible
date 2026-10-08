"""Fix provider_change_log: nullable account_id + allow the 'updated' action.

0034 declared account_id NOT NULL while also ON DELETE SET NULL, so purging an
account (which must keep the immutable log, per the table comment) would fail.
The partial index in 0034 (WHERE account_id IS NOT NULL) already assumed it can
be null. The credential-update route also logs action='updated', which the 0034
CHECK constraint rejects.

0034 is already applied in production, so this is a forward migration rather
than an edit to 0034.

Revision ID: 0039
Revises: 0038
"""

from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE provider_change_log ALTER COLUMN account_id DROP NOT NULL")
    op.execute("ALTER TABLE provider_change_log DROP CONSTRAINT provider_change_log_action_check")
    op.execute(
        """
        ALTER TABLE provider_change_log ADD CONSTRAINT provider_change_log_action_check
            CHECK (action IN ('added', 'removed', 'verified', 'failed', 'activated',
                              'deactivated', 'updated'))
        """
    )


def downgrade() -> None:
    # Rows written with 'updated' or a null account_id would block the downgrade,
    # so remove them first.
    op.execute("DELETE FROM provider_change_log WHERE action = 'updated' OR account_id IS NULL")
    op.execute("ALTER TABLE provider_change_log DROP CONSTRAINT provider_change_log_action_check")
    op.execute(
        """
        ALTER TABLE provider_change_log ADD CONSTRAINT provider_change_log_action_check
            CHECK (action IN ('added', 'removed', 'verified', 'failed', 'activated', 'deactivated'))
        """
    )
    op.execute("ALTER TABLE provider_change_log ALTER COLUMN account_id SET NOT NULL")
