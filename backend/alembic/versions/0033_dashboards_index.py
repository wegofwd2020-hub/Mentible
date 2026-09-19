"""Dashboard query performance index — journey analytics sub-project 4"""

from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Index for dashboard queries: re-engagement, ttfr, response_rate, retry_effectiveness
    # These queries filter on intervention_sent_at and group/filter by stall_reason, customer_response_type
    op.create_index(
        "journey_state_dashboards_idx",
        "journey_state",
        ["intervention_sent_at", "stall_reason", "customer_response_type"],
        where=op.text("intervention_sent_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("journey_state_dashboards_idx")
