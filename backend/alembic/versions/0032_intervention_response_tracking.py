"""intervention response tracking — journey analytics sub-project 3"""

import sqlalchemy as sa
from sqlalchemy import text

from alembic import op

revision = "0032"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "journey_state",
        sa.Column("intervention_sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "journey_state",
        sa.Column("customer_response_type", sa.Text, nullable=True),
    )
    op.add_column(
        "journey_state",
        sa.Column("intervention_attempt_count", sa.Integer, server_default="0", nullable=False),
    )
    op.create_index(
        "journey_state_intervention_status_sent_at_idx",
        "journey_state",
        ["intervention_status", "intervention_sent_at"],
        postgresql_where=text("intervention_status = 'not_started'"),
    )


def downgrade() -> None:
    op.drop_index("journey_state_intervention_status_sent_at_idx")
    op.drop_column("journey_state", "intervention_attempt_count")
    op.drop_column("journey_state", "customer_response_type")
    op.drop_column("journey_state", "intervention_sent_at")
