"""MANDATORY CI gate — verifies the BYOK key never leaks into log output.

Per ADR-001 §"Logging discipline" and the project's top pitfall #1, this
test is the primary defence against accidental key leakage in logs. It
exercises every code path that handles the api_key with a known fake key
and asserts the key never appears in any captured log record.

If this test ever starts failing, do NOT skip it. Find the leak and fix it.

Adding new endpoints or code paths that touch the api_key REQUIRES adding
a new exercise to this test.
"""

from __future__ import annotations

import io
import json
import uuid

import pytest
import structlog

from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.core.log_redaction import (
    configure_logging,
    get_logger,
    redact_keys,
)

# ── Helpers ───────────────────────────────────────────────────────────────────


def _capture_log_output(level: str = "INFO") -> tuple[io.StringIO, structlog.stdlib.BoundLogger]:
    """Wire structlog to write to an in-memory buffer so we can scan it."""
    buffer = io.StringIO()

    def _writer(_logger, _method, event_dict):
        buffer.write(json.dumps(event_dict) + "\n")
        return event_dict

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            redact_keys,
            _writer,
            structlog.processors.JSONRenderer(),
        ],
        cache_logger_on_first_use=False,
    )
    return buffer, structlog.get_logger("leak_test")


# ── Direct-redaction tests ────────────────────────────────────────────────────


class TestRedactionProcessor:
    def test_value_pattern_matched(self, known_test_api_key: str):
        out = redact_keys(None, "info", {"event": "x", "raw": known_test_api_key})
        assert known_test_api_key not in json.dumps(out)
        assert "<redacted-anthropic-key>" in json.dumps(out)

    def test_field_name_redacted(self, known_test_api_key: str):
        out = redact_keys(None, "info", {"event": "x", "api_key": known_test_api_key})
        assert known_test_api_key not in json.dumps(out)
        assert out["api_key"] == "<redacted>"

    def test_authorization_header_field_redacted(self, known_test_api_key: str):
        out = redact_keys(None, "info", {"Authorization": f"Bearer {known_test_api_key}"})
        assert known_test_api_key not in json.dumps(out)

    def test_nested_dict(self, known_test_api_key: str):
        out = redact_keys(None, "info", {"req": {"api_key": known_test_api_key}})
        assert known_test_api_key not in json.dumps(out)

    def test_nested_list(self, known_test_api_key: str):
        out = redact_keys(None, "info", {"items": [known_test_api_key, "ok"]})
        assert known_test_api_key not in json.dumps(out)

    def test_partial_key_caught(self):
        partial = "sk-ant-abcdefghijkl"
        out = redact_keys(None, "info", {"event": partial})
        assert "sk-ant-" not in out["event"]


# ── End-to-end tests via /generate ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_generate_endpoint_does_not_log_key(client, known_test_api_key, capsys):
    """Submit a /generate request with a known fake key; assert no log line
    captured anywhere contains the key. Mocks AnthropicProvider so the test
    is fully offline."""
    import asyncio
    from unittest.mock import patch

    buffer, _ = _capture_log_output()

    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        # Simulate a successful (mock) generation. The test only cares that
        # the key never lands in any log along the way.
        MockProvider.return_value.generate.return_value = (
            '{"topic": "Quadratic formula", "level": "student", "language": "en", '
            '"synopsis": "x", "learning_objectives": ["a"], '
            '"sections": [{"heading": "h", "body_markdown": "b"}], '
            '"key_takeaways": ["k"], "further_reading": []}',
            10,
            10,
        )

        resp = await client.post(
            "/api/v1/generate",
            json={
                "request_id": str(uuid.uuid4()),
                "topic": "Quadratic formula",
                "level": "student",
                "language": "en",
                "format": "lesson",
                "api_key": known_test_api_key,
            },
        )
        assert resp.status_code == 202

        # Wait for the background task to complete so we capture all its logs.
        await asyncio.sleep(0.2)

    log_text = buffer.getvalue()
    captured = capsys.readouterr()
    combined = log_text + captured.out + captured.err

    assert known_test_api_key not in combined, f"BYOK key leaked into log output: {combined[:500]}"


@pytest.mark.asyncio
async def test_generate_validation_error_does_not_log_key(client, capsys):
    """Even when validation fails, no fragment of the api_key should leak.

    Pydantic's default error response includes the field NAMES but not values,
    but we verify defensively: send a key that would also be flagged by the
    field-name redactor AND the value pattern.
    """
    buffer, _ = _capture_log_output()
    leaky = "sk-ant-VALIDATION_PATH_LEAK_PROBE_xxxxxxxxxxxxxx"

    resp = await client.post(
        "/api/v1/generate",
        json={
            "request_id": str(uuid.uuid4()),
            "topic": "",  # invalid — triggers validation error
            "level": "student",
            "language": "en",
            "format": "lesson",
            "api_key": leaky,
        },
    )
    assert resp.status_code == 422

    captured = capsys.readouterr()
    combined = buffer.getvalue() + captured.out + captured.err

    # Pydantic 422 errors echo invalid INPUT back to the client. Sensitive
    # fields like api_key must NOT be echoed in the response body either.
    assert leaky not in resp.text, "api_key fragment leaked into 422 response body"
    assert leaky not in combined


def test_envelope_does_not_log_key(known_test_api_key, capsys):
    """The encryption helper itself must not emit any log line containing the
    plaintext key (it shouldn't log at all, but we check defensively)."""
    configure_logging("DEBUG")
    log = get_logger("envelope_test")
    log.info("invoking_envelope", note="about to encrypt")

    master_key = parse_master_key("0" * 64)
    blob = encrypt_api_key(master_key, str(uuid.uuid4()), known_test_api_key)
    assert blob is not None

    captured = capsys.readouterr()
    assert known_test_api_key not in captured.out
    assert known_test_api_key not in captured.err


@pytest.mark.asyncio
async def test_worker_path_does_not_log_key(client, known_test_api_key, capsys):
    """The full /generate → background worker → Anthropic-call path must not
    leak the user's api_key, even when the upstream SDK raises an exception
    that contains the key in its message.

    This is the most realistic leakage vector — error paths inside a worker
    that capture the offending input. ADR-001 explicitly requires this gate.
    """
    import asyncio
    import json as _json
    from unittest.mock import patch

    buffer, _ = _capture_log_output()

    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        # SDK raises with the user's key in the exception message — the most
        # dangerous case. The wrapper must swallow the chained exception so
        # the key never lands in any log.
        MockProvider.return_value.generate.side_effect = RuntimeError(
            f"upstream rejected key={known_test_api_key}"
        )

        resp = await client.post(
            "/api/v1/generate",
            json={
                "request_id": str(uuid.uuid4()),
                "topic": "Anything",
                "level": "student",
                "language": "en",
                "format": "lesson",
                "api_key": known_test_api_key,
            },
        )
        assert resp.status_code == 202

        # Wait for the background task to complete (and fail).
        await asyncio.sleep(0.2)
        # Read the job to make sure it failed cleanly.
        status = await client.get(f"/api/v1/jobs/{resp.json()['job_id']}")
        body = status.json()
        # Either still queued/running due to async timing, or already failed —
        # both are acceptable here. The key point is the LEAK assertion below.
        assert body["status"] in {"queued", "running", "failed"}
        if body["status"] == "failed":
            assert known_test_api_key not in _json.dumps(body), (
                "api_key leaked into failed-job response"
            )

    captured = capsys.readouterr()
    combined = buffer.getvalue() + captured.out + captured.err
    assert known_test_api_key not in combined, (
        f"BYOK key leaked into log output via worker error path: {combined[:500]}"
    )
