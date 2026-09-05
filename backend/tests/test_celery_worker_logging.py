"""Worker-side no-key-in-logs gate (ADR-001 backstop for the Celery worker).

The Celery worker (`celery -A backend.src.core.celery_app worker`) is a
separate OS process from the FastAPI/uvicorn app and handles BYOK api keys
inside trust generation tasks. Per CLAUDE.md rule #1 / ADR-001, the structlog
`redact_keys` filter must ALWAYS be installed as a catch-all in any process
that touches a key — this test locks in that `worker_process_init` wires it
into the worker.

We don't spin up a live worker; we invoke the `worker_process_init` signal
handler directly (that's exactly what Celery does inside each forked/spawned
worker child) and then assert redaction is in force, using the same
capsys-capture idiom as `backend/tests/test_no_key_in_logs.py`
(`test_envelope_does_not_log_key`).
"""

from __future__ import annotations

import structlog

from backend.src.core.celery_app import _init_worker_logging, celery_app
from backend.src.core.log_redaction import get_logger, redact_keys


class TestWorkerProcessInitLoggingHandler:
    def test_signal_handler_is_registered_on_worker_process_init(self) -> None:
        from celery.signals import worker_process_init

        # `celery.utils.dispatch.Signal.receivers` holds (id, weakref) pairs —
        # dereference each weakref to get the actual connected callable.
        resolved = [receiver() for _id, receiver in worker_process_init.receivers]
        assert _init_worker_logging in resolved

    def test_worker_process_init_redacts_key_from_log_output(
        self, known_test_api_key: str, capsys
    ) -> None:
        # Fire the signal handler exactly as Celery does inside a real worker
        # child process (`worker_process_init.send(sender=...)`).
        _init_worker_logging()

        log = get_logger("worker_logging_test")
        log.info(
            "leak_probe",
            api_key=known_test_api_key,
            note=f"upstream rejected key={known_test_api_key}",
        )

        captured = capsys.readouterr()
        combined = captured.out + captured.err
        assert known_test_api_key not in combined, (
            f"BYOK key leaked into worker log output after worker_process_init fired: "
            f"{combined[:500]}"
        )

    def test_redact_keys_present_in_processor_chain_after_handler_runs(self) -> None:
        _init_worker_logging()
        config = structlog.get_config()
        assert redact_keys in config["processors"], (
            "redact_keys missing from the structlog processor chain after "
            "worker_process_init fired — the ADR-001 backstop is not wired "
            "into the worker"
        )


def test_celery_app_imports_cleanly_and_registers_expected_tasks() -> None:
    # Regression guard: the worker entrypoint import chain
    # (`backend.src.core.celery_app`) must still succeed and register the
    # liveness `ping` task, the trust per-topic generation task, and the STT
    # capture task. `trust.transcribe` was defined but never imported by
    # celery_app, so the worker rejected every transcribe job as unregistered.
    assert "ping" in celery_app.tasks
    assert "trust.generate_topic" in celery_app.tasks
    assert "trust.transcribe" in celery_app.tasks
