"""Provider LLM change tracking — super-admin visibility of LLM-per-user history

Adds a durable log of every provider credential change (user-initiated or
admin-triggered) and tracks the active provider per account so super-admins can
see what LLM each user is configured to use.

- `account.active_provider_id`: the currently selected provider for generation
- `provider_change_log`: immutable log of all provider changes (added, removed,
  verified, failed) with actor attribution (who made the change + when)

Revision ID: 0034
Revises: 0033
Create Date: 2026-09-21
"""

from alembic import op
import sqlalchemy as sa

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Track active provider per account
    op.add_column(
        "account",
        sa.Column("active_provider_id", sa.Text(), nullable=True),
    )

    # Immutable log of provider changes (never deleted, survives account deletion)
    op.execute(
        """
        CREATE TABLE provider_change_log (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            account_id        uuid NOT NULL REFERENCES account(id) ON DELETE SET NULL,
            provider_id       text NOT NULL,
            action            text NOT NULL
                CHECK (action IN ('added', 'removed', 'verified', 'failed', 'activated', 'deactivated')),
            actor_sub         text,
            actor_email       text,
            reason            text,
            created_at        timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    # Newest-first by account, useful for the admin profile detail
    op.execute(
        "CREATE INDEX provider_change_log_by_account_idx ON provider_change_log "
        "(account_id, created_at DESC, id DESC) WHERE account_id IS NOT NULL"
    )
    # Optional: track changes by provider across all users (to spot widespread issues)
    op.execute(
        "CREATE INDEX provider_change_log_by_provider_idx ON provider_change_log "
        "(provider_id, created_at DESC)"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS provider_change_log")
    op.drop_column("account", "active_provider_id")
