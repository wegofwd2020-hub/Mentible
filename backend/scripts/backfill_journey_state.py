"""Backfill journey_state + project_journey_state from analytics_event history.

Usage:
    cd backend && python -m scripts.backfill_journey_state --from-date 2026-09-15 --to-date 2026-09-27
"""

import argparse
import asyncio
import sys
from datetime import datetime
from pathlib import Path
from uuid import UUID

import asyncpg

# Add parent to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

from src.analytics.journey import evaluate_journey_state
from src.analytics.repo import (
    get_events_for_user,
    get_events_for_project,
    upsert_journey_state,
    upsert_project_journey_state,
)


async def backfill(from_date: str, to_date: str) -> None:
    """Backfill journey state for all users with events in date range."""
    import os
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL not set in environment")
    conn = await asyncpg.connect(database_url)
    try:
        # Parse date strings to datetime
        from_dt = datetime.fromisoformat(from_date)
        to_dt = datetime.fromisoformat(to_date).replace(hour=23, minute=59, second=59)

        # Get all unique users with events in the date range
        users = await conn.fetch(
            """
            SELECT DISTINCT user_id FROM analytics_event
            WHERE occurred_at >= $1 AND occurred_at <= $2
            AND user_id IS NOT NULL
            ORDER BY user_id
            """,
            from_dt,
            to_dt,
        )

        print(f"Backfilling {len(users)} users from {from_date} to {to_date}")

        for row in users:
            user_id = UUID(str(row["user_id"]))  # Convert asyncpg UUID to Python UUID
            print(f"  Processing user {user_id}...", end=" ", flush=True)

            # Get all events for this user (ordered by time)
            events = await get_events_for_user(conn, user_id)
            event_dicts = [dict(e) for e in events]

            # Evaluate global journey state
            if event_dicts:
                result = evaluate_journey_state(event_dicts)
                await upsert_journey_state(
                    conn,
                    user_id=user_id,
                    current_journey_stage=result.current_journey_stage.value,
                    stage_status=result.stage_status.value,
                    last_meaningful_event=result.last_meaningful_event,
                    last_meaningful_event_at=result.last_meaningful_event_at,
                    intervention_attempt_count=0,
                )

            # Get all projects this user has events in
            projects = await conn.fetch(
                """
                SELECT DISTINCT project_id FROM analytics_event
                WHERE user_id = $1 AND project_id IS NOT NULL
                ORDER BY project_id
                """,
                UUID(user_id),
            )

            # Evaluate per-project journey state
            for proj in projects:
                project_id = UUID(str(proj["project_id"]))  # Convert asyncpg UUID to Python UUID
                project_events = await get_events_for_project(
                    conn, user_id, project_id
                )
                project_event_dicts = [dict(e) for e in project_events]

                if project_event_dicts:
                    result = evaluate_journey_state(project_event_dicts)
                    await upsert_project_journey_state(
                        conn,
                        user_id=user_id,
                        project_id=project_id,
                        current_journey_stage=result.current_journey_stage.value,
                        stage_status=result.stage_status.value,
                        last_meaningful_event=result.last_meaningful_event,
                        last_meaningful_event_at=result.last_meaningful_event_at,
                        intervention_attempt_count=0,
                    )

            print("✓")

        print(f"\n✅ Backfill complete: {len(users)} users processed")

    finally:
        await conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Backfill journey state from events")
    parser.add_argument(
        "--from-date",
        default="2026-09-15",
        help="Start date (YYYY-MM-DD)",
    )
    parser.add_argument(
        "--to-date",
        default=datetime.now().strftime("%Y-%m-%d"),
        help="End date (YYYY-MM-DD)",
    )
    args = parser.parse_args()

    asyncio.run(backfill(args.from_date, args.to_date))
