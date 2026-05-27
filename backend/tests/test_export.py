"""Tests for POST /api/v1/export.

The compiler subprocess is mocked so these run without Node (CI is Python-only).
A real end-to-end test auto-skips unless the Node compiler is built locally.
"""

from __future__ import annotations

import json
import os
import shutil

import pytest

from backend.config import settings
from backend.src.export import compiler
from backend.src.export.compiler import CompilerError, ExportResult, ExportValidationError

# ── A minimal but complete book with one generated topic ─────────────────────
_BOOK = {
    "id": "11111111-1111-1111-1111-111111111111",
    "title": "Physics & Friends",
    "toc": {
        "subjects": [
            {
                "subject_label": "Mechanics",
                "units": [
                    {"id": "u1", "title": "Kinematics", "subtopics": [], "prerequisites": []}
                ],
            }
        ]
    },
    "createdAt": "2026-05-27T00:00:00.000Z",
    "updatedAt": "2026-05-27T00:00:00.000Z",
    "content": {
        "u1": {
            "topicId": "u1",
            "title": "Kinematics",
            "generatedAt": "2026-05-27T00:00:00.000Z",
            "lesson": {
                "topic": "Kinematics",
                "level": "intro",
                "language": "en",
                "synopsis": "Motion.",
                "learning_objectives": ["Use $v=d/t$"],
                "sections": [{"heading": "Velocity", "body_markdown": "It is $v=d/t$."}],
                "key_takeaways": ["Velocity is a vector"],
                "further_reading": [],
            },
        }
    },
}


# ── validate_book (no subprocess) ────────────────────────────────────────────
def test_validate_book_accepts_a_well_formed_book():
    data = compiler.validate_book(json.dumps(_BOOK).encode())
    assert data["title"] == "Physics & Friends"


@pytest.mark.parametrize(
    "raw, needle",
    [
        (b"not json", "valid JSON"),
        (b"[]", "book object"),
        (b'{"toc": {"subjects": []}}', "missing a title"),
        (b'{"title": "X"}', "table of contents"),
    ],
)
def test_validate_book_rejects_bad_input(raw, needle):
    with pytest.raises(ExportValidationError) as exc:
        compiler.validate_book(raw)
    assert needle in str(exc.value)


# ── endpoint with the compiler mocked ────────────────────────────────────────
async def test_export_returns_epub(client, monkeypatch):
    async def fake_compile(raw: bytes) -> ExportResult:
        return ExportResult(epub=b"PK\x03\x04-fake-epub", title="Physics & Friends")

    monkeypatch.setattr(compiler, "compile_epub", fake_compile)

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/epub+zip")
    assert resp.headers["content-disposition"] == 'attachment; filename="physics-friends.epub"'
    assert resp.content == b"PK\x03\x04-fake-epub"


async def test_export_validation_error_is_422(client, monkeypatch):
    async def fake_compile(raw: bytes) -> ExportResult:
        raise ExportValidationError("Book has no generated content to compile.")

    monkeypatch.setattr(compiler, "compile_epub", fake_compile)

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "no generated content" in resp.json()["detail"]


async def test_export_compiler_error_is_500_without_internals(client, monkeypatch):
    async def fake_compile(raw: bytes) -> ExportResult:
        raise CompilerError("node exploded: /secret/path/stacktrace")

    monkeypatch.setattr(compiler, "compile_epub", fake_compile)

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Could not compile the book."
    assert "secret" not in resp.text  # no leaked internals


async def test_export_rejects_oversized_body(client, monkeypatch):
    called = False

    async def fake_compile(raw: bytes) -> ExportResult:
        nonlocal called
        called = True
        return ExportResult(epub=b"", title="x")

    monkeypatch.setattr(compiler, "compile_epub", fake_compile)

    big = b"x" * (25 * 1024 * 1024 + 1)
    resp = await client.post("/api/v1/export", content=big)
    assert resp.status_code == 413
    assert called is False  # rejected before invoking the compiler


# ── real end-to-end (auto-skips unless the Node compiler is built) ───────────
_HAVE_COMPILER = bool(shutil.which(settings.node_bin)) and os.path.exists(settings.compiler_cli)


@pytest.mark.skipif(
    not _HAVE_COMPILER, reason="Node compiler not built (run: cd compiler && npm run build)"
)
async def test_export_end_to_end_real_compiler(client):
    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"  # a real zip/EPUB
    assert len(resp.content) > 1000
