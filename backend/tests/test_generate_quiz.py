"""Source-grounded quiz generation (`format="quiz"` + `source_text`).

Open Shelves F2 Task 1 — extends the existing `/generate` job pipeline (see
`test_generate_e2e.py`) with a quiz mode that answers ONLY from a supplied
chapter passage. Mirrors the e2e-style fixtures there: mocked `build_provider`,
fakeredis, the ASGI `client` fixture. No live Anthropic/Redis.

The `QuizOutput` schema mirrors the mobile `QuizSet`/`QuizQuestion`/`QuizOption`
types field-for-field (`mobile/src/types/book.ts:91-112`):
  QuizOption:   { option_id, text }
  QuizQuestion: { question_id, question_text, question_type, options,
                  correct_option, explanation, difficulty }
  QuizSet:      { set_number, questions, total_questions, passing_score,
                  estimated_duration_minutes }
"""

from __future__ import annotations

import asyncio
import json
import uuid
from unittest.mock import patch

import pytest

from backend.tests.helpers import fake_provider

_SOURCE_TEXT = (
    "The old mill stood at the bend of the river, its great wheel turned by "
    "the current for over a hundred years. When the drought came, the "
    "villagers built a smaller channel to keep the water flowing to the "
    "wheel, and the mill never stopped grinding grain."
)

_FAKE_QUIZ_JSON = json.dumps(
    {
        "set_number": 1,
        "questions": [
            {
                "question_id": "q1",
                "question_text": "What turned the mill's great wheel?",
                "question_type": "multiple_choice",
                "options": [
                    {"option_id": "A", "text": "Wind"},
                    {"option_id": "B", "text": "The river's current"},
                    {"option_id": "C", "text": "A steam engine"},
                    {"option_id": "D", "text": "Horses"},
                ],
                "correct_option": "B",
                "explanation": "The passage says the wheel was 'turned by the current'.",
                "difficulty": "easy",
            },
            {
                "question_id": "q2",
                "question_text": "What did the villagers build during the drought?",
                "question_type": "multiple_choice",
                "options": [
                    {"option_id": "A", "text": "A dam"},
                    {"option_id": "B", "text": "A well"},
                    {"option_id": "C", "text": "A smaller channel"},
                    {"option_id": "D", "text": "A new mill"},
                ],
                "correct_option": "C",
                "explanation": (
                    "The passage says they 'built a smaller channel to keep the "
                    "water flowing to the wheel'."
                ),
                "difficulty": "medium",
            },
        ],
        "total_questions": 2,
        "passing_score": 1,
        "estimated_duration_minutes": 3,
    }
)


def _quiz_request_body(api_key: str, **overrides) -> dict:
    body = {
        "request_id": str(uuid.uuid4()),
        "topic": "Chapter 1: The Mill",
        "level": "student",
        "language": "en",
        "format": "quiz",
        "api_key": api_key,
        "source_text": _SOURCE_TEXT,
    }
    body.update(overrides)
    return body


async def _wait_for_status(client, job_id: str, target: str, timeout: float = 5.0) -> dict:
    deadline = asyncio.get_event_loop().time() + timeout
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/jobs/{job_id}")
        body = resp.json()
        if body.get("status") in (target, "failed"):
            return body
        await asyncio.sleep(0.05)
    raise AssertionError(f"job did not reach status={target} within {timeout}s; last={body}")


# ── (a) valid quiz JSON → schema-valid QuizOutput ──────────────────────────────


@pytest.mark.asyncio
async def test_quiz_generation_done(client, fake_redis, known_test_api_key):
    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_FAKE_QUIZ_JSON),
    ):
        submit = await client.post("/api/v1/generate", json=_quiz_request_body(known_test_api_key))
        assert submit.status_code == 202
        job_id = submit.json()["job_id"]

        body = await _wait_for_status(client, job_id, "done")

    assert body["status"] == "done"
    result = body["result"]
    # Field-for-field parity with mobile QuizSet — no mapping layer.
    assert result["set_number"] == 1
    assert result["total_questions"] == 2
    assert result["passing_score"] == 1
    assert result["estimated_duration_minutes"] == 3
    assert len(result["questions"]) == 2
    q1 = result["questions"][0]
    assert q1["question_id"] == "q1"
    assert q1["question_type"] == "multiple_choice"
    assert q1["correct_option"] == "B"
    assert q1["explanation"]
    assert q1["difficulty"] == "easy"
    opts = q1["options"]
    assert len(opts) == 4
    assert opts[0]["option_id"] == "A"
    assert opts[0]["text"] == "Wind"
    # NOT the wrong field names the plan initially guessed.
    assert "option_text" not in opts[0]
    assert "is_correct" not in opts[0]
    assert "set_title" not in result

    trust = body["trust"]
    assert trust["validation"]["schema_id"] == "quiz@1"
    assert trust["validation"]["schema_validated"] is True

    # ADR-001: the key never rides the serialized status row.
    assert known_test_api_key not in json.dumps(body)


# ── (b) invalid-then-valid → generate_validated retry path ─────────────────────


@pytest.mark.asyncio
async def test_quiz_retries_invalid_then_succeeds(client, fake_redis, known_test_api_key):
    fake = fake_provider(responses=["not json at all", _FAKE_QUIZ_JSON])
    with patch("backend.src.generate.tasks.build_provider", return_value=fake):
        submit = await client.post("/api/v1/generate", json=_quiz_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]

        body = await _wait_for_status(client, job_id, "done")

    assert body["status"] == "done"
    assert body["result"]["total_questions"] == 2
    assert fake.generate.call_count == 2  # one repair turn
    assert body["trust"]["validation"]["repair_attempts"] == 1


@pytest.mark.asyncio
async def test_quiz_schema_violation_marks_failed(client, fake_redis, known_test_api_key):
    """Valid JSON that doesn't match QuizOutput (e.g. missing questions) fails
    cleanly after the repair budget, same as the lesson path."""
    bad = json.dumps({"set_number": 1})  # no questions at all
    with patch("backend.src.generate.tasks.build_provider", return_value=fake_provider(text=bad)):
        submit = await client.post("/api/v1/generate", json=_quiz_request_body(known_test_api_key))
        job_id = submit.json()["job_id"]
        body = await _wait_for_status(client, job_id, "failed")

    assert body["status"] == "failed"
    assert "validation" in body["error"].lower()


# ── source_text required for quiz ───────────────────────────────────────────────


@pytest.mark.asyncio
async def test_quiz_without_source_text_rejected(client, known_test_api_key):
    body = _quiz_request_body(known_test_api_key)
    del body["source_text"]
    submit = await client.post("/api/v1/generate", json=body)
    assert submit.status_code == 422


@pytest.mark.asyncio
async def test_source_text_too_long_rejected(client, known_test_api_key):
    body = _quiz_request_body(known_test_api_key, source_text="x" * 16001)
    submit = await client.post("/api/v1/generate", json=body)
    assert submit.status_code == 422


# ── (c) the lesson path is byte-behavior unchanged ──────────────────────────────

_FAKE_LESSON_JSON = json.dumps(
    {
        "topic": "Quadratic formula",
        "level": "student",
        "language": "en",
        "synopsis": "The quadratic formula gives the roots of any quadratic equation.",
        "learning_objectives": [
            "Identify a quadratic equation in standard form",
            "Apply the quadratic formula to find roots",
            "Interpret the discriminant",
        ],
        "sections": [
            {"heading": "Standard form", "body_markdown": "Every quadratic can be written as..."},
        ],
        "key_takeaways": ["Check standard form first", "The discriminant tells you the root count"],
        "further_reading": [],
    }
)


@pytest.mark.asyncio
async def test_lesson_path_unchanged_when_format_lesson(client, fake_redis, known_test_api_key):
    """format="lesson" still runs the original lesson prompt + LessonOutput
    validation, untouched by the new quiz branch."""
    with patch(
        "backend.src.generate.tasks.build_provider",
        return_value=fake_provider(text=_FAKE_LESSON_JSON),
    ):
        body = {
            "request_id": str(uuid.uuid4()),
            "topic": "Quadratic formula",
            "level": "student",
            "language": "en",
            "format": "lesson",
            "api_key": known_test_api_key,
        }
        submit = await client.post("/api/v1/generate", json=body)
        assert submit.status_code == 202
        job_id = submit.json()["job_id"]

        result = await _wait_for_status(client, job_id, "done")

    assert result["status"] == "done"
    assert result["result"]["topic"] == "Quadratic formula"
    assert result["trust"]["validation"]["schema_id"] == "lesson@1"
