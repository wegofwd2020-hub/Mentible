"""Celery app config + ping task (Phase A, T1).

Asserts the Celery app is wired for durability (task_acks_late +
task_reject_on_worker_lost, so a worker crash mid-task re-delivers rather than
silently dropping) and that broker/backend come from settings.redis_url — not
a hardcoded URL. Also asserts a `ping` task is registered and runs (called
directly, synchronously — no broker/worker needed for this test).
"""

from __future__ import annotations

from backend.config import settings
from backend.src.core.celery_app import celery_app, ping


def test_celery_app_durability_config() -> None:
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_celery_app_serialization_config() -> None:
    assert celery_app.conf.task_serializer == "json"
    assert celery_app.conf.result_serializer == "json"
    assert celery_app.conf.accept_content == ["json"]


def test_celery_app_broker_and_backend_from_settings() -> None:
    assert celery_app.conf.broker_url == settings.redis_url
    assert celery_app.conf.result_backend == settings.redis_url


def test_ping_task_registered() -> None:
    assert "ping" in celery_app.tasks


def test_ping_task_returns_pong() -> None:
    assert ping.run() == "pong"
