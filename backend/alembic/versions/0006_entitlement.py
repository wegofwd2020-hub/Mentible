"""entitlement — per-account managed plan grant (ADR-005 D6, Phase 3)

One row per account: which plan it's entitled to, the entitlement status, and the
current period. Drives managed eligibility + the cost cap (the plan's allowance over
its period), replacing the Phase-1 staff allowlist + Phase-2 fixed config cap as the
real path. Set by an operator for now (no payments yet — Phase 4 wires RevenueCat
webhooks to this). Cascades with `account`.

Revision ID: 0006
Revises: 0005
Create Date: 2026-06-30
"""

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE entitlement (
            account_id   uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
            plan_id      text NOT NULL,
            status       text NOT NULL DEFAULT 'active',
            period_start timestamptz NOT NULL DEFAULT now(),
            period_end   timestamptz NOT NULL,
            updated_at   timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS entitlement")
