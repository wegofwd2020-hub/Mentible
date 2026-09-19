"""Celery scheduled tasks — journey analytics background jobs (sub-project 5A).

Daily stall-rate monitoring via Celery beat.
"""

from __future__ import annotations

import logging

from celery import shared_task

from backend.config import settings
from backend.src.db.pool import get_connection

logger = logging.getLogger(__name__)


@shared_task(name="analytics.daily_stall_rate_check", bind=True)
def daily_stall_rate_check(self) -> dict:
    """Run daily at 8 AM ET. Check stall rate and alert if exceeded.

    Celery task wrapper (sync) that fetches a DB connection and runs the async
    stall-rate check. Returns task metadata.

    Args:
        self: Celery task instance (for retry logic)

    Returns:
        dict with keys: was_alerted (bool), rate_pct (float), threshold (float)

    Side effects:
        - Calculates stall rate from journey_state
        - If rate > threshold: sends email + logs audit event
        - Errors in email/logging don't fail task (logged as warning)
    """
    import asyncio

    from backend.src.analytics.alerting import send_stall_rate_alert_if_exceeded

    threshold = settings.stall_rate_threshold
    ops_email = settings.ops_alert_email

    try:
        # Get DB connection from pool
        conn = get_connection()

        # Run async function in event loop
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            was_alerted = loop.run_until_complete(
                send_stall_rate_alert_if_exceeded(
                    conn,
                    threshold=threshold,
                    ops_email=ops_email,
                )
            )
        finally:
            loop.close()

        result = {
            "was_alerted": was_alerted,
            "threshold": threshold,
            "ops_email": ops_email,
        }

        if was_alerted:
            logger.warning(f"Stall rate alert sent to {ops_email}")
        else:
            logger.info("Stall rate within acceptable range")

        return result

    except Exception as e:
        logger.error(f"daily_stall_rate_check task failed: {e}", exc_info=True)
        # Retry up to 3 times with exponential backoff
        raise self.retry(exc=e, countdown=60, max_retries=3)
