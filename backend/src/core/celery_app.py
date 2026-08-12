"""Celery application (Phase A — trust-async-gen).

Mentible's first Celery app. Broker + result backend are both Redis, reusing
`settings.redis_url` (the same Redis instance the BYOK envelope + job-status
code already depends on — see `backend/src/core/redis_dep.py`).

Durability config (task_acks_late + task_reject_on_worker_lost): a worker
process crashing or being killed mid-task must NOT silently drop the task —
it should be re-delivered to another worker. `worker_prefetch_multiplier=1`
keeps a busy worker from hoarding tasks it hasn't started yet, so redelivery
after a crash is timely rather than stuck behind a backlog.

Per-topic trust generation tasks are registered here in Phase A's later task
(T2) — this module stays the single Celery entrypoint so the worker command
(`celery -A backend.src.core.celery_app worker`) only has to import one path.
"""

from __future__ import annotations

from celery import Celery

from backend.config import settings

celery_app = Celery("mentible", broker=settings.redis_url, backend=settings.redis_url)

celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)


@celery_app.task(name="ping")
def ping() -> str:
    """Liveness check — confirms the worker is up and processing tasks."""
    return "pong"


# Trust (per-topic generation) tasks are registered here in T2:
#   from backend.src.trust import tasks as trust_tasks
