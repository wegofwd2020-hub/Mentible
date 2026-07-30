"""Endpoint tests for POST /api/v1/derivatives/post (ADR-037 D8, Task 3).

Inline synchronous generation (no job queue, no /jobs poll) — mirrors the
BYOK-vs-managed key selection of /generate but returns the result in the same
request. Patches `backend.src.derivatives.generate.build_provider` (where the
provider factory is actually called from) with a fake provider — no live
Anthropic, no live DB.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest

from backend.tests.helpers import fake_provider

_GOOD = json.dumps(
    {
        "variants": [
            {"hook": f"h{i}", "body": f"b{i}", "hashtags": ["#x"], "cta": None} for i in range(3)
        ]
    }
)

pytestmark = pytest.mark.asyncio


async def test_byok_post_ok_and_key_never_leaks(client, known_test_api_key, caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={
                "source_text": "Stormwater.",
                "platform": "linkedin",
                "api_key": known_test_api_key,
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert len(body["variants"]) == 3
    assert body["provenance"] == "ai-generated"
    assert body["platform"] == "linkedin"
    # AC: the key never rides the response or any log line.
    assert known_test_api_key not in json.dumps(body)
    assert known_test_api_key not in caplog.text


async def test_managed_ineligible_400(client):
    # no api_key + anonymous caller (no auth override) → not managed-eligible →
    # generic 400, no key material in the body.
    r = await client.post("/api/v1/derivatives/post", json={"source_text": "s"})
    assert r.status_code == 400
    # No leaked secret material — the body is a generic message.
    assert "sk-" not in json.dumps(r.json())


async def test_platform_x_reaches_generation(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "platform": "x", "api_key": known_test_api_key},
        )
    assert r.status_code == 200
    assert r.json()["platform"] == "x"


async def test_bad_output_502(client, known_test_api_key):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        r = await client.post(
            "/api/v1/derivatives/post",
            json={"source_text": "s", "api_key": known_test_api_key},
        )
    assert r.status_code == 502
    # Never echoes the key on a failure response either.
    assert known_test_api_key not in json.dumps(r.json())


async def test_empty_source_422(client, known_test_api_key):
    r = await client.post(
        "/api/v1/derivatives/post",
        json={"source_text": "", "api_key": known_test_api_key},
    )
    assert r.status_code == 422
    # The 422 handler scrubs the echoed body — the key must not reappear.
    assert known_test_api_key not in json.dumps(r.json())
