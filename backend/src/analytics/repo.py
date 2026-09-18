"""Analytics repo layer — the sole write path for events and journey state.
asyncpg raw SQL, matching the codebase's existing pattern (backend/src/feedback/repo.py)."""

from __future__ import annotations

import json
import uuid

import asyncpg

from backend.src.analytics.schemas import EventIn


async def record_event(
    conn: asyncpg.Connection, *, event: EventIn, user_id: uuid.UUID | None
) -> None:
    """Insert one analytics_event row. Caller is responsible for calling
    evaluate-and-persist journey state afterward if this event should update it —
    this function only appends to the log."""
    await conn.execute(
        """
        INSERT INTO analytics_event (
            event_id, event_name, occurred_at, anonymous_id, user_id, session_id,
            project_id, journey_stage, use_case, content_type, plan_id,
            acquisition_source, device_class, experiment_variant, success,
            error_code, duration_ms, properties
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb)
        """,
        event.event_id,
        event.event_name.value,
        event.occurred_at,
        event.anonymous_id,
        user_id,
        event.session_id,
        event.project_id,
        event.journey_stage.value if event.journey_stage else None,
        event.use_case,
        event.content_type,
        event.plan_id,
        event.acquisition_source,
        event.device_class.value,
        event.experiment_variant,
        event.success,
        event.error_code,
        event.duration_ms,
        json.dumps(event.properties),
    )


async def get_journey_state(conn: asyncpg.Connection, user_id: uuid.UUID) -> asyncpg.Record | None:
    return await conn.fetchrow("SELECT * FROM journey_state WHERE user_id = $1", user_id)


async def upsert_journey_state(
    conn: asyncpg.Connection,
    *,
    user_id: uuid.UUID,
    current_journey_stage: str,
    stage_status: str,
    last_meaningful_event: str | None,
    last_meaningful_event_at,
) -> None:
    await conn.execute(
        """
        INSERT INTO journey_state (
            user_id, current_journey_stage, stage_status,
            last_meaningful_event, last_meaningful_event_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT (user_id) DO UPDATE SET
            current_journey_stage = EXCLUDED.current_journey_stage,
            stage_status = EXCLUDED.stage_status,
            last_meaningful_event = EXCLUDED.last_meaningful_event,
            last_meaningful_event_at = EXCLUDED.last_meaningful_event_at,
            updated_at = now()
        """,
        user_id,
        current_journey_stage,
        stage_status,
        last_meaningful_event,
        last_meaningful_event_at,
    )


async def get_events_for_user(conn: asyncpg.Connection, user_id: uuid.UUID) -> list[asyncpg.Record]:
    """Full event history for one user, oldest first — the input to evaluate_journey_state."""
    return await conn.fetch(
        "SELECT * FROM analytics_event WHERE user_id = $1 ORDER BY occurred_at ASC", user_id
    )


async def merge_anonymous_into_user(
    conn: asyncpg.Connection, *, anonymous_id: str, user_id: uuid.UUID
) -> int:
    """Backfill user_id onto every anonymous_id-tagged event at signup. Returns rows updated.
    Idempotent — re-running against an already-merged anonymous_id updates 0 rows."""
    result = await conn.execute(
        "UPDATE analytics_event SET user_id = $1 WHERE anonymous_id = $2 AND user_id IS NULL",
        user_id,
        anonymous_id,
    )
    # asyncpg execute() returns a string like "UPDATE 3"
    return int(result.split()[-1])
