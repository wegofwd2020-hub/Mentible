"""device — per-install device registry for the admin user view (ADR-020)

A lightweight "which devices is this account using" set, populated by the client
on sign-in (a stable per-install id + a friendly label). Heartbeat model: each
report bumps last_seen; rows persist until the device or account is deleted. No
key material, no content — metadata only (D5). Cascades with `account`, so a
purge (DELETE account / reset-test-user) clears a user's devices automatically.

Revision ID: 0004
Revises: 0003
Create Date: 2026-06-24
"""

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE device (
            account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            device_id   text NOT NULL,
            label       text,
            platform    text,
            first_seen  timestamptz NOT NULL DEFAULT now(),
            last_seen   timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (account_id, device_id)
        )
        """
    )
    op.execute("CREATE INDEX device_account_idx ON device (account_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS device")
