"""analytics instrumentation: analytics_event log + journey_state evaluator"""

from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # analytics_event: append-only event log for user journey instrumentation.
    # Columns mirror the Common Event Contract from the journey analytics spec.
    # properties JSONB holds event-specific fields (narrower than one column per type).
    op.execute(
        """
        CREATE TABLE analytics_event (
            event_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            event_name            text NOT NULL,
            occurred_at           timestamptz NOT NULL,
            anonymous_id          text,
            user_id               uuid REFERENCES account(id) ON DELETE SET NULL,
            session_id            text NOT NULL,
            project_id            text,
            journey_stage         text,
            use_case              text,
            content_type          text,
            plan_id               text,
            acquisition_source    text,
            device_class          text NOT NULL,
            experiment_variant    text,
            success               boolean,
            error_code            text,
            duration_ms           integer,
            properties            jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at            timestamptz NOT NULL DEFAULT now()
        )
        """
    )

    # Indexes for common query patterns: by user timeline, by anonymous session, by event type.
    op.execute(
        "CREATE INDEX analytics_event_user_occurred_at_idx "
        "ON analytics_event (user_id, occurred_at)"
    )
    op.execute("CREATE INDEX analytics_event_anonymous_id_idx ON analytics_event (anonymous_id)")
    op.execute(
        "CREATE INDEX analytics_event_event_name_occurred_at_idx "
        "ON analytics_event (event_name, occurred_at)"
    )

    # journey_state: one row per user, upserted as events arrive.
    # Mirrors the Measurement Model table from the journey analytics spec.
    # Columns for stall_reason, stalled_at, intervention_status, next_best_action, resumed_at
    # are provisioned here (sub-project 1 does not write them; sub-project 2 will).
    op.execute(
        """
        CREATE TABLE journey_state (
            user_id                 uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
            current_journey_stage   text NOT NULL DEFAULT 'discover_join',
            stage_status            text NOT NULL DEFAULT 'not_started',
            last_meaningful_event   text,
            last_meaningful_event_at timestamptz,
            stall_reason            text,
            stalled_at              timestamptz,
            intervention_status     text,
            next_best_action        text,
            resumed_at              timestamptz,
            updated_at              timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE journey_state")
    op.execute("DROP TABLE analytics_event")
