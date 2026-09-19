"""Celery async tasks for analytics — stall detection scheduler (sub-project 2B, deferred).

Phase 1 (current): Stall detection engine built; state written on-demand via
evaluate_journey_state(). Phase 2 (deferred, 2B): Daily Celery beat job that
runs the evaluator over all active users, keeping journey_state fresh.

This file is a skeleton. Implementation deferred to sub-project 2B per the plan.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


# @shared_task(name="analytics.detect_stalls_daily")
# def detect_stalls_daily() -> None:
#     """Run stall detection for all active users (scheduler job).
#
#     Runs daily at 2 AM UTC (configurable via Celery beat schedule).
#     For each active user:
#     1. Fetch event history from analytics_event table
#     2. Call evaluate_journey_state() with stall detection enabled
#     3. Upsert the result to journey_state
#
#     This is a background job that keeps journey_state fresh without requiring
#     a user request to trigger stall detection.
#
#     Phase 2 placeholder — actual implementation in sub-project 2B.
#     """
#     pass


# Configuration for Celery beat schedule (deferred to sub-project 2B):
# from celery.schedules import crontab
#
# CELERY_BEAT_SCHEDULE = {
#     "detect-stalls-daily": {
#         "task": "backend.src.analytics.tasks.detect_stalls_daily",
#         "schedule": crontab(hour=2, minute=0),  # 2 AM UTC daily
#     },
# }
#
# Add this to the main Celery app config in backend/main.py or backend/src/core/celery_app.py
