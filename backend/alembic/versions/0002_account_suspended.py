"""account.suspended — operator suspend/reactivate (ADR-020 D3.1)

Adds a `suspended` flag (+ `suspended_at`) to `account` so a super-admin can
suspend/reactivate a user. Enforced on authenticated routes via
`require_active_user` (ADR-020 O6: this blocks our authed routes; it does NOT
stop public BYOK generation, whose key travels in the request body).

Revision ID: 0002
Revises: 0001
Create Date: 2026-06-20
"""

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        ALTER TABLE account
            ADD COLUMN suspended     boolean NOT NULL DEFAULT false,
            ADD COLUMN suspended_at  timestamptz
        """
    )


def downgrade() -> None:
    op.execute("ALTER TABLE account DROP COLUMN IF EXISTS suspended_at")
    op.execute("ALTER TABLE account DROP COLUMN IF EXISTS suspended")
