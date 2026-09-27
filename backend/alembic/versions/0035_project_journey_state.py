"""Per-project journey state table for UX bottleneck analysis.

Tracks user journey stage per project (separate from global journey_state).
Enables product teams to identify which stages have highest dropout and improve UX.

Sub-project: UX analytics (journey analytics phase 2)
ADR: TBD
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import text

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create project_journey_state table (mirrors journey_state but per-project)
    op.create_table(
        "project_journey_state",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("project_id", sa.UUID(), nullable=False),
        sa.Column("current_journey_stage", sa.VARCHAR(50), nullable=False),
        sa.Column("stage_status", sa.VARCHAR(50), nullable=False),
        sa.Column("last_meaningful_event", sa.VARCHAR(255), nullable=True),
        sa.Column(
            "last_meaningful_event_at", sa.DateTime(timezone=True), nullable=True
        ),
        sa.Column("stalled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("stall_reason", sa.VARCHAR(255), nullable=True),
        # Intervention tracking (per-project)
        sa.Column("intervention_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("intervention_status", sa.VARCHAR(50), nullable=True),
        sa.Column("intervention_attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("customer_response_type", sa.VARCHAR(50), nullable=True),
        sa.Column("resumed_at", sa.DateTime(timezone=True), nullable=True),
        # Metadata
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "project_id", name="uq_project_journey_state_user_project"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["account.id"],
            name="fk_project_journey_state_user",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["project_id"],
            ["project.id"],
            name="fk_project_journey_state_project",
            ondelete="CASCADE",
        ),
    )

    # Indexes for dashboard queries
    # Bottleneck detection: filter by project + stage, calculate stall rates
    op.create_index(
        "idx_project_journey_state_stage",
        "project_journey_state",
        ["project_id", "current_journey_stage"],
    )

    # Stalled users: filter by project + stall, show stuck users
    op.create_index(
        "idx_project_journey_state_stalled",
        "project_journey_state",
        ["project_id", "stalled_at"],
        postgresql_where=text("stalled_at IS NOT NULL"),
    )

    # User-centric: lookup user's projects + states
    op.create_index(
        "idx_project_journey_state_user_project",
        "project_journey_state",
        ["user_id", "project_id"],
    )

    # Intervention effectiveness: filter by sent_at, group by response_type
    op.create_index(
        "idx_project_journey_state_intervention",
        "project_journey_state",
        ["project_id", "intervention_sent_at"],
        postgresql_where=text("intervention_sent_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_project_journey_state_intervention")
    op.drop_index("idx_project_journey_state_user_project")
    op.drop_index("idx_project_journey_state_stalled")
    op.drop_index("idx_project_journey_state_stage")
    op.drop_table("project_journey_state")
