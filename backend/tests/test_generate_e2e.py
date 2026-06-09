"""End-to-end /generate flow tests.

Submits a request, runs the background task to completion (mocked Anthropic),
polls /jobs/{id}, and asserts the result is a valid LessonOutput.

These tests exercise the FULL pipeline:
- envelope encrypt → store
- BackgroundTask dispatch
- envelope fetch → decrypt
- Anthropic call (mocked)
- JSON parse
- LessonOutput schema validation
- status write
- envelope shred
"""

from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import patch

import pytest

# A complete, valid LessonOutput used as the mocked Anthropic response.
_FAKE_LESSON_JSON = json.dumps(
    {
        "topic": "Quadratic formula",
        "level": "student",
        "language": "en",
        "synopsis": "The quadratic formula gives the roots of any quadratic equation.",
        "learning_objectives": [
            "Identify a quadratic equation in standard form",
            "Apply the quadratic formula to find roots",
            "Interpret the discriminant to predict number of real roots",
        ],
        "sections": [
            {
                "heading": "Standard form",
                "body_markdown": "Every quadratic can be written as $ax^2 + bx + c = 0$ with $a \\\\neq 0$.",
            },
            {
                "heading": "The formula",
                "body_markdown": "$$x = \\\\frac{-b \\\\pm \\\\sqrt{b^2 - 4ac}}{2a}$$",
            },
        ],
        "key_takeaways": [
            "Always check that the equation is in standard form first",
            "The discriminant tells you how many real roots exist",
            "Practice with at least 5 different cases",
        ],
        "further_reading": ["Completing the square", "Vieta's formulas"],
    }
)


def _request_body(api_key: str, **overrides) -> dict:
    body = {
        "request_id": str(uuid.uuid4()),
        "topic": "Quadratic formula",
        "level": "student",
        "language": "en",
        "format": "lesson",
        "api_key": api_key,
        "depth": "standard",
    }
    body.update(overrides)
    return body


async def _wait_for_status(client, job_id: str, target: str, timeout: float = 5.0) -> dict:
    """Poll /jobs/{id} until status matches `target` or timeout."""
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/jobs/{job_id}")
        body = resp.json()
        if body.get("status") == target:
            return body
        if body.get("status") == "failed":
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"job did not reach status={target} within {timeout}s; last={body}")


# ── Happy path ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_full_loop_done(client, fake_redis, known_test_api_key):
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (_FAKE_LESSON_JSON, 100, 500)

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        assert submit.status_code == 202
        job_id = submit.json()["job_id"]

        body = await _wait_for_status(client, job_id, "done")

    assert body["status"] == "done"
    result = body["result"]
    assert result["topic"] == "Quadratic formula"
    assert len(result["sections"]) == 2
    # Provenance records which provider/model + versions produced the unit.
    prov = body["provenance"]
    assert prov["provider"] == "anthropic"
    assert prov["model"]  # resolved model id
    assert "contract_version" in prov and "integration_version" in prov
    assert (
        "$x = " in result["sections"][1]["body_markdown"]
        or "x =" in result["sections"][1]["body_markdown"]
    )


@pytest.mark.asyncio
async def test_retries_invalid_json_then_succeeds(client, fake_redis, known_test_api_key):
    """A bad first response (invalid JSON) is retried; a good second one wins."""
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.side_effect = [
            ("not json at all", 1, 1),  # attempt 1 — fails to parse
            (_FAKE_LESSON_JSON, 100, 500),  # attempt 2 — valid
        ]

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]

        body = await _wait_for_status(client, job_id, "done")

    assert body["status"] == "done"
    assert body["result"]["topic"] == "Quadratic formula"
    assert MockProvider.return_value.generate.call_count == 2


@pytest.mark.asyncio
async def test_instructions_threaded_into_prompt(client, fake_redis, known_test_api_key):
    """Author enhancement instructions reach the Anthropic prompt."""
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (_FAKE_LESSON_JSON, 100, 500)

        body = _request_body(known_test_api_key, instructions="Add a diagram for the T-shape")
        submit = await client.post("/api/v1/generate", json=body)
        job_id = submit.json()["job_id"]
        await _wait_for_status(client, job_id, "done")

        prompt = MockProvider.return_value.generate.call_args.args[0]

    assert "Add a diagram for the T-shape" in prompt


@pytest.mark.asyncio
async def test_envelope_shredded_after_done(client, fake_redis, known_test_api_key):
    """The byok:{job_id} key must be DELETED from Redis after the worker finishes."""
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (_FAKE_LESSON_JSON, 100, 500)

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]

        await _wait_for_status(client, job_id, "done")

    leftover = await fake_redis.get(f"byok:{job_id}")
    assert leftover is None, "envelope was not shredded after generation"


# ── Failure paths ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_anthropic_failure_marks_job_failed(client, fake_redis, known_test_api_key):
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.side_effect = RuntimeError("upstream timeout")

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]

        body = await _wait_for_status(client, job_id, "failed")

    assert body["status"] == "failed"
    # Transient/provider errors fail fast with a generic, key-free message.
    assert body["error"]


@pytest.mark.asyncio
async def test_envelope_shredded_after_failure(client, fake_redis, known_test_api_key):
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.side_effect = RuntimeError("boom")

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        await _wait_for_status(client, job_id, "failed")

    leftover = await fake_redis.get(f"byok:{job_id}")
    assert leftover is None, "envelope was not shredded after failure"


@pytest.mark.asyncio
async def test_invalid_json_marks_failed(client, fake_redis, known_test_api_key):
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = ("not json at all", 100, 50)

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "failed")

    assert body["status"] == "failed"
    # After the repair budget is exhausted, unparseable output is a validation failure.
    assert "validation" in body["error"].lower()


@pytest.mark.asyncio
async def test_schema_violation_marks_failed(client, fake_redis, known_test_api_key):
    """Anthropic returns valid JSON that doesn't match LessonOutput schema."""
    bad = json.dumps({"topic": "x"})  # missing nearly everything
    with patch("pipeline.providers.anthropic_adapter.AnthropicProvider") as MockProvider:
        MockProvider.return_value.generate.return_value = (bad, 50, 20)

        submit = await client.post("/api/v1/generate", json=_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "failed")

    assert body["status"] == "failed"
    assert "validation" in body["error"].lower()


@pytest.mark.asyncio
async def test_unsupported_format_marks_failed(client, fake_redis, known_test_api_key):
    """Quiz/Explanation aren't implemented in this PR — they fail cleanly."""
    submit = await client.post(
        "/api/v1/generate",
        json=_request_body(known_test_api_key, format="quiz"),
    )
    job_id = submit.json()["job_id"]
    body = await _wait_for_status(client, job_id, "failed")

    assert "not yet supported" in body["error"]


# ── Multi-provider (Phase 2b) ─────────────────────────────────────────────────

_FAKE_OPENAI_KEY = "sk-TEST_FAKE_OPENAI_KEY_xxxxxxxxxxxxxxxxxxxxxxxx"


def _openai_provider_returning(content: str):
    """A real OpenAICompatibleProvider backed by a MockTransport (no network) that
    returns `content` as the chat-completion. Used to drive the worker's OpenAI
    path deterministically."""
    import httpx
    from pipeline.providers.contract import Capabilities
    from pipeline.providers.openai_compatible import OpenAICompatibleProvider

    def _handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            200,
            json={
                "choices": [{"message": {"content": content}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 500},
            },
        )

    return OpenAICompatibleProvider(
        api_key=_FAKE_OPENAI_KEY,
        base_url="https://api.openai.com/v1",
        model="gpt-4o-mini",
        capabilities=Capabilities(json_object=True),
        client=httpx.Client(transport=httpx.MockTransport(_handler)),
    )


@pytest.mark.asyncio
async def test_openai_provider_path_done(client, fake_redis):
    """A request with provider_id=openai + an sk- key generates through the
    OpenAI-compatible provider and the same validate→repair loop."""
    provider = _openai_provider_returning(_FAKE_LESSON_JSON)
    with patch("backend.src.generate.tasks.build_provider", return_value=provider):
        body = _request_body(_FAKE_OPENAI_KEY, provider_id="openai")
        submit = await client.post("/api/v1/generate", json=body)
        assert submit.status_code == 202
        job_id = submit.json()["job_id"]
        result = await _wait_for_status(client, job_id, "done")

    assert result["status"] == "done"
    assert result["result"]["topic"] == "Quadratic formula"
    assert result["provenance"]["provider"] == "openai"


@pytest.mark.asyncio
async def test_unknown_provider_rejected(client, known_test_api_key):
    """An unknown provider_id is a 422 at the request boundary."""
    body = _request_body(known_test_api_key, provider_id="not-a-provider")
    submit = await client.post("/api/v1/generate", json=body)
    assert submit.status_code == 422


@pytest.mark.asyncio
async def test_wrong_key_format_for_provider_rejected(client):
    """Anthropic provider with a non-sk-ant- key is rejected (422)."""
    body = _request_body(_FAKE_OPENAI_KEY, provider_id="anthropic")
    submit = await client.post("/api/v1/generate", json=body)
    assert submit.status_code == 422


# ── Free providers (Phase 5) ──────────────────────────────────────────────────

_FAKE_GROQ_KEY = "gsk_TEST_FAKE_GROQ_KEY_xxxxxxxxxxxxxxxxxxxxxx"


@pytest.mark.asyncio
async def test_groq_wrong_key_prefix_rejected(client):
    """Groq keys are gsk_ — an sk- key is rejected for groq (422), no task runs."""
    body = _request_body(_FAKE_OPENAI_KEY, provider_id="groq")  # sk-, wrong for groq
    submit = await client.post("/api/v1/generate", json=body)
    assert submit.status_code == 422


@pytest.mark.asyncio
async def test_groq_provider_path_done(client, fake_redis):
    """A gsk_ key + provider_id=groq passes the shape check and generates through
    the OpenAI-compatible seam (no network — build_provider is patched)."""
    provider = _openai_provider_returning(_FAKE_LESSON_JSON)  # any OpenAI-compatible fake
    with patch("backend.src.generate.tasks.build_provider", return_value=provider):
        body = _request_body(_FAKE_GROQ_KEY, provider_id="groq")
        submit = await client.post("/api/v1/generate", json=body)
        assert submit.status_code == 202
        result = await _wait_for_status(client, submit.json()["job_id"], "done")
    assert result["status"] == "done"


@pytest.mark.asyncio
async def test_gemini_accepts_non_sk_key(client, fake_redis):
    """Gemini keys (AIza…) have no sk- prefix — the request is accepted."""
    provider = _openai_provider_returning(_FAKE_LESSON_JSON)
    with patch("backend.src.generate.tasks.build_provider", return_value=provider):
        body = _request_body("AIzaFAKE_GEMINI_KEY_xxxxxxxxxxxxxxxxxxx", provider_id="gemini")
        submit = await client.post("/api/v1/generate", json=body)
        assert submit.status_code == 202
        # Drive the job to completion inside the patch so no real Gemini call runs.
        result = await _wait_for_status(client, submit.json()["job_id"], "done")
    assert result["status"] == "done"
