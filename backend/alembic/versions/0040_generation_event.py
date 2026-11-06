"""Shared Free-tier generation counter: `generation_event` + backfill.

The rolling Free cap (ADR-037 D3 / ADR-043: 20 generations per rolling 30 days) used to
count `topic_version` + `artifact_version` rows. The legacy `/generate` and derivative
routes write no such rows, so they could never be counted. This table is written by
EVERY generation entry point (`quota.charge_generation`), so one counter covers all of
them.

Backfill: existing trust generations are copied in so the rolling window does not reset
on deploy (`created_by_sub` → `account.idp_sub`).

Revision ID: 0040
Revises: 0039
"""

from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE generation_event (
            id          bigserial PRIMARY KEY,
            account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            route       text NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX generation_event_account_created_idx "
        "ON generation_event (account_id, created_at)"
    )
    op.execute(
        """
        INSERT INTO generation_event (account_id, route, created_at)
        SELECT a.id, 'backfill', v.created_at
          FROM topic_version v
          JOIN account a ON a.idp_sub = v.created_by_sub
        UNION ALL
        SELECT a.id, 'backfill', v.created_at
          FROM artifact_version v
          JOIN account a ON a.idp_sub = v.created_by_sub
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS generation_event")
