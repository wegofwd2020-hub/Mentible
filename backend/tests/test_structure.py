"""End-to-end POST /structure flow tests.

Submits a free-text TOC, runs the background task to completion (mocked
Anthropic at the provider seam), polls the shared /jobs/{id} endpoint, and
asserts the result is a valid StructuredTOC. Also covers the bounded-retry
behaviour on malformed JSON, fail-fast on transport errors, idempotency, and
envelope shredding.

Mock seam: same as the /generate tests — patch
`backend.src.generate.anthropic_caller.AnthropicProvider`, since structure
tasks reuse that module's `call_anthropic`.
"""

from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import patch

import pytest

# A valid StructuredTOC as the mocked Anthropic response.
_FAKE_TOC_JSON = json.dumps(
    {
        "subjects": [
            {
                "subject_label": "Physics",
                "units": [
                    {
                        "title": "Kinematics",
                        "subtopics": ["Speed", "Velocity", "Acceleration"],
                        "prerequisites": [],
                    },
                    {
                        "title": "Dynamics",
                        "subtopics": ["Newton's laws", "Friction"],
                        "prerequisites": ["Kinematics"],
                    },
                ],
            }
        ]
    }
)


def _request_body(api_key: str, **overrides) -> dict:
    body = {
        "request_id": str(uuid.uuid4()),
        "raw_toc": "Physics\n- Kinematics: speed, velocity, acceleration\n- Dynamics: Newton's laws, friction",
        "api_key": api_key,
    }
    body.update(overrides)
    return body


async def _wait_for_status(client, job_id: str, target: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    body: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/jobs/{job_id}")
        body = resp.json()
        if body.get("status") in (target, "failed"):
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"job did not reach status={target} within {timeout}s; last={body}")


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_loop_done(client, fake_redis, known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (_FAKE_TOC_JSON, 100, 300)

        submit = await client.post("/api/v1/structure", json=_request_body(known_test_api_key))
        assert submit.status_code == 202
        job_id = submit.json()["job_id"]

        body = await _wait_for_status(client, job_id, "done")

    assert body["status"] == "done"
    result = body["result"]
    assert result["subjects"][0]["subject_label"] == "Physics"
    assert len(result["subjects"][0]["units"]) == 2
    assert result["subjects"][0]["units"][1]["prerequisites"] == ["Kinematics"]


@pytest.mark.asyncio
async def test_envelope_shredded_after_done(client, fake_redis, known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (_FAKE_TOC_JSON, 100, 300)

        submit = await client.post("/api/v1/structure", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        await _wait_for_status(client, job_id, "done")

    assert await fake_redis.get(f"byok:{job_id}") is None, "envelope not shredded"


# ── Retry behaviour ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_malformed_json_retries_then_succeeds(client, fake_redis, known_test_api_key):
    """Two malformed responses, then a good one → done, with 3 provider calls."""
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.side_effect = [
            ("not json", 10, 5),
            ("{ still bad", 10, 5),
            (_FAKE_TOC_JSON, 100, 300),
        ]

        submit = await client.post("/api/v1/structure", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "done")

        assert MockProvider.return_value.generate.call_count == 3

    assert body["status"] == "done"
    assert body["result"]["subjects"][0]["subject_label"] == "Physics"


@pytest.mark.asyncio
async def test_malformed_json_exhausts_retries_marks_failed(client, fake_redis, known_test_api_key):
    """Always-malformed JSON → failed after exactly 3 attempts; envelope shredded."""
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = ("never valid json", 10, 5)

        submit = await client.post("/api/v1/structure", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "failed")

        assert MockProvider.return_value.generate.call_count == 3

    assert body["status"] == "failed"
    assert "table of contents" in body["error"]
    assert await fake_redis.get(f"byok:{job_id}") is None


@pytest.mark.asyncio
async def test_empty_toc_tree_marks_failed(client, fake_redis, known_test_api_key):
    """Valid JSON whose tree has no units → schema-level StructureError → failed."""
    empty = json.dumps({"subjects": [{"subject_label": "Physics", "units": []}]})
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (empty, 10, 5)

        submit = await client.post("/api/v1/structure", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "failed")

    assert body["status"] == "failed"


# ── Transport failure: fail fast, no retry ──────────────────────────────────────


@pytest.mark.asyncio
async def test_anthropic_failure_marks_failed_without_retry(client, fake_redis, known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.side_effect = RuntimeError("upstream timeout")

        submit = await client.post("/api/v1/structure", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "failed")

        # A transport error must NOT burn extra Anthropic calls on retries.
        assert MockProvider.return_value.generate.call_count == 1

    assert body["status"] == "failed"
    assert "Anthropic" in body["error"]
    assert await fake_redis.get(f"byok:{job_id}") is None


# ── Idempotency ─────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_idempotent_resubmit_returns_same_job(client, fake_redis, known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (_FAKE_TOC_JSON, 100, 300)

        body = _request_body(known_test_api_key)
        first = await client.post("/api/v1/structure", json=body)
        second = await client.post("/api/v1/structure", json=body)

    assert first.json()["job_id"] == second.json()["job_id"]


# ── Validation ──────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_bad_api_key_shape_rejected_at_boundary(client, known_test_api_key):
    submit = await client.post(
        "/api/v1/structure",
        json=_request_body("not-an-anthropic-key"),
    )
    assert submit.status_code == 422


@pytest.mark.asyncio
async def test_empty_toc_rejected_at_boundary(client, known_test_api_key):
    submit = await client.post(
        "/api/v1/structure",
        json=_request_body(known_test_api_key, raw_toc=""),
    )
    assert submit.status_code == 422
