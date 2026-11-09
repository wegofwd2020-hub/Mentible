"""Link each trust membership to the invited email that created it.

Revoke used to match memberships by the account's *current* email. If an expert's
sign-in email changed after redeem, revoking the original invite left their access in
place. Redeem now records the invited (lowercased) email on the membership row, and
revoke deletes by that link.

Backfill: existing memberships get the account's current email, since the original
invite email was not stored. That is a best guess. Rows whose account has no email stay
NULL, and the revoke query keeps a fallback on the account email for NULL rows.

Revision ID: 0043
Revises: 0042
"""

from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE project_membership ADD COLUMN invited_email text")
    op.execute(
        "UPDATE project_membership pm SET invited_email = lower(a.email) "
        "FROM account a WHERE a.id = pm.account_id AND a.email IS NOT NULL"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS project_membership_project_invited_email_idx "
        "ON project_membership (project_id, invited_email)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS project_membership_project_invited_email_idx")
    op.execute("ALTER TABLE project_membership DROP COLUMN IF EXISTS invited_email")
