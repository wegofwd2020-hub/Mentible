"""Idempotency tests — duplicate request_id must return the same job_id.

Critical for BYOK: a client retry that arrived after the first request was
accepted must NOT trigger a second Anthropic call (and therefore a second bill
on the user's account).
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest

from backend.tests.helpers import fake_provider

_LESSON_JSON = json.dumps(
    {
        "topic": "x",
        "level": "student",
        "language": "en",
        "synopsis": "x",
        "learning_objectives": ["a"],
        "sections": [{"heading": "h", "body_markdown": "b"}],
        "key_takeaways": ["k"],
        "further_reading": [],
    }
)


def _request_body(api_key: str, request_id: str, **overrides) -> dict:
    body = {
        "request_id": request_id,
        "topic": "Quadratic formula",
        "level": "student",
        "language": "en",
        "format": "lesson",
        "api_key": api_key,
        "depth": "standard",
    }
    body.update(overrides)
    return body


@pytest.mark.asyncio
async def test_duplicate_request_id_returns_same_job_id(client, known_test_api_key):
    """Two POST /generate with the same request_id → same job_id."""
    rid = str(uuid.uuid4())

    # Mock the provider to keep the test fast and avoid background-task races.
    with patch(
        "backend.src.generate.tasks.build_provider", return_value=fake_provider(text=_LESSON_JSON)
    ):
        first = await client.post("/api/v1/generate", json=_request_body(known_test_api_key, rid))
        second = await client.post("/api/v1/generate", json=_request_body(known_test_api_key, rid))

    assert first.status_code == 202
    assert second.status_code == 202
    assert first.json()["job_id"] == second.json()["job_id"], (
        "idempotency dedup failed — duplicate request_id created a second job"
    )


@pytest.mark.asyncio
async def test_different_request_ids_get_different_job_ids(client, known_test_api_key):
    with patch(
        "backend.src.generate.tasks.build_provider", return_value=fake_provider(text=_LESSON_JSON)
    ):
        first = await client.post(
            "/api/v1/generate",
            json=_request_body(known_test_api_key, str(uuid.uuid4())),
        )
        second = await client.post(
            "/api/v1/generate",
            json=_request_body(known_test_api_key, str(uuid.uuid4())),
        )

    assert first.json()["job_id"] != second.json()["job_id"]


@pytest.mark.asyncio
async def test_idempotency_does_not_re_call_anthropic(client, known_test_api_key):
    """Three rapid retries with the same request_id should build the provider
    at most ONCE (the others short-circuit at the idempotency check)."""
    rid = str(uuid.uuid4())

    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_LESSON_JSON),
    ) as mock_build:
        for _ in range(3):
            await client.post("/api/v1/generate", json=_request_body(known_test_api_key, rid))

        # Wait briefly for the (single) background task to complete.
        import asyncio

        await asyncio.sleep(0.2)

    # The provider was built AT MOST once. On rare scheduling interleavings the
    # first task may not have fired yet when retries arrived, but never > once.
    assert mock_build.call_count <= 1
