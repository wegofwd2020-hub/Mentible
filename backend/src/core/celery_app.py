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
from celery.signals import worker_process_init

from backend.config import settings
from backend.src.core.log_redaction import configure_logging

celery_app = Celery("mentible", broker=settings.redis_url, backend=settings.redis_url)

celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)


@worker_process_init.connect
def _init_worker_logging(**_kwargs: object) -> None:
    """Install the structlog key-redaction filter in every worker process.

    Per CLAUDE.md rule #1 / ADR-001, `redact_keys` is the mandatory backstop
    against a BYOK key ever reaching a log line. `configure_logging` (which
    wires it into the structlog processor chain) was previously only called
    from `backend/main.py` — the uvicorn/API entrypoint — so a worker started
    via `celery -A backend.src.core.celery_app worker` ran with structlog's
    default (unredacted) processors.

    `worker_process_init` fires inside each forked/spawned worker child, which
    is the robust placement: it survives prefork forking and the spawn
    start-method, and it does NOT fire on a plain `import
    backend.src.core.celery_app` in the API process or in tests — so it can't
    clobber their own logging config.
    """
    configure_logging(settings.log_level)


@celery_app.task(name="ping")
def ping() -> str:
    """Liveness check — confirms the worker is up and processing tasks."""
    return "pong"


# Trust (per-topic generation) tasks — importing registers `trust.generate_topic`
# on this app (the module's @celery_app.task decorator runs at import time).
# Deferred to the bottom of the module (not a top-level import) because
# backend.src.trust.tasks imports `celery_app` from HERE — a top-level import
# would be circular.
from backend.src.trust import tasks as trust_tasks  # noqa: E402,F401

# STT capture task — importing registers `trust.transcribe` on this app (the
# module's @celery_app.task decorator runs at import time). Same deferred-import
# rationale as trust_tasks above. Without this the worker rejects every
# transcribe job with "Received unregistered task of type 'trust.transcribe'"
# and the job never reaches done/failed (the client polls to a timeout).
from backend.src.trust import transcribe_tasks as trust_transcribe_tasks  # noqa: E402,F401
