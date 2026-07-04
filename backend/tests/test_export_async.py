"""Tests for the async export job endpoints (POST /export/jobs, GET status +
artifact). The compiler subprocess is mocked so these run without Node.

The compile runs as a FastAPI BackgroundTask; `_wait_for_status` polls the status
route (yielding the event loop) until the job reaches a terminal state, mirroring
the /generate e2e tests.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import shutil
import uuid

import pytest

from backend.config import settings
from backend.src.export import compiler
from backend.src.export.compiler import CompilerError, ExportResult, ExportValidationError

# Reuse a minimal but complete book with one generated topic.
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


def _fake_compile(record: dict, *, data: bytes = b"%PDF-bytes", warnings=None):
    async def fake(raw: bytes, *, fmt: str = "epub", diagrams: bool = False) -> ExportResult:
        record["fmt"] = fmt
        record["diagrams"] = diagrams
        return ExportResult(data=data, title="Physics & Friends", warnings=warnings or [])

    return fake


async def _wait_for_status(client, job_id: str, timeout: float = 5.0) -> dict:
    """Poll the export status route until the job leaves queued/running."""
    deadline = asyncio.get_event_loop().time() + timeout
    body: dict = {}
    while asyncio.get_event_loop().time() < deadline:
        resp = await client.get(f"/api/v1/export/jobs/{job_id}")
        body = resp.json()
        if body.get("status") in ("done", "failed"):
            return body
        await asyncio.sleep(0.02)
    raise AssertionError(f"job never finished within {timeout}s; last={body}")


async def test_submit_returns_202_and_job_completes(client, monkeypatch):
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec, data=b"PK-epub"))

    submit = await client.post("/api/v1/export/jobs?format=epub", content=json.dumps(_BOOK))
    assert submit.status_code == 202
    job_id = submit.json()["job_id"]
    assert submit.json()["status"] == "queued"

    body = await _wait_for_status(client, job_id)
    assert body["status"] == "done"
    assert body["filename"] == "physics-friends.epub"
    assert body["format"] == "epub"
    assert body["size"] == len(b"PK-epub")
    assert body["warnings"] == 0
    assert rec == {"fmt": "epub", "diagrams": False}


async def test_artifact_download_streams_bytes_with_headers(client, monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile({}, data=b"PK-epub-bytes"))

    submit = await client.post("/api/v1/export/jobs?format=epub", content=json.dumps(_BOOK))
    job_id = submit.json()["job_id"]
    await _wait_for_status(client, job_id)

    art = await client.get(f"/api/v1/export/jobs/{job_id}/artifact")
    assert art.status_code == 200
    assert art.content == b"PK-epub-bytes"
    assert art.headers["content-type"].startswith("application/epub+zip")
    assert art.headers["content-disposition"] == 'attachment; filename="physics-friends.epub"'
    assert art.headers["x-content-warnings"] == "0"


async def test_pdf_with_diagrams_passes_flags_through(client, monkeypatch):
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec, data=b"%PDF"))

    submit = await client.post(
        "/api/v1/export/jobs?format=pdf&diagrams=true", content=json.dumps(_BOOK)
    )
    job_id = submit.json()["job_id"]
    body = await _wait_for_status(client, job_id)

    assert body["status"] == "done"
    assert body["filename"] == "physics-friends.pdf"
    assert rec == {"fmt": "pdf", "diagrams": True}

    art = await client.get(f"/api/v1/export/jobs/{job_id}/artifact")
    assert art.headers["content-type"].startswith("application/pdf")


async def test_done_job_carries_trust_manifest(client, monkeypatch):
    monkeypatch.setattr(compiler, "compile_book", _fake_compile({}))

    submit = await client.post("/api/v1/export/jobs?format=epub", content=json.dumps(_BOOK))
    job_id = submit.json()["job_id"]
    body = await _wait_for_status(client, job_id)

    m = json.loads(base64.b64decode(body["trust"]).decode())
    assert m["trust_manifest_version"] == 1
    assert m["compliance"]["ruleset"] == "mentible-professional@1.0"
    assert m["integrity"]["content_hash"].startswith("sha256:")

    # Same manifest rides the artifact download header.
    art = await client.get(f"/api/v1/export/jobs/{job_id}/artifact")
    assert art.headers["x-content-trust-manifest"] == body["trust"]


async def test_compiler_error_marks_job_failed_without_internals(client, monkeypatch):
    async def boom(raw, *, fmt="epub", diagrams=False):
        raise CompilerError("node exploded: /secret/path/stacktrace")

    monkeypatch.setattr(compiler, "compile_book", boom)

    submit = await client.post("/api/v1/export/jobs?format=pdf", content=json.dumps(_BOOK))
    job_id = submit.json()["job_id"]
    body = await _wait_for_status(client, job_id)

    assert body["status"] == "failed"
    assert body["error"] == "Could not compile the book."
    assert "secret" not in json.dumps(body)

    # No artifact for a failed job.
    art = await client.get(f"/api/v1/export/jobs/{job_id}/artifact")
    assert art.status_code == 409


async def test_validation_error_in_task_surfaces_safe_message(client, monkeypatch):
    async def novel(raw, *, fmt="epub", diagrams=False):
        raise ExportValidationError("Book has no generated content to compile.")

    monkeypatch.setattr(compiler, "compile_book", novel)

    submit = await client.post("/api/v1/export/jobs?format=epub", content=json.dumps(_BOOK))
    job_id = submit.json()["job_id"]
    body = await _wait_for_status(client, job_id)

    assert body["status"] == "failed"
    assert "no generated content" in body["error"]


async def test_submit_rejects_unknown_format_before_dispatch(client, monkeypatch):
    called = False

    async def fake(raw, *, fmt="epub", diagrams=False):
        nonlocal called
        called = True
        return ExportResult(data=b"", title="x", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export/jobs?format=mobi", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "epub" in resp.json()["detail"]
    assert called is False


async def test_submit_rejects_cover_format(client, monkeypatch):
    # cover stays on the synchronous /export endpoint (sub-second thumbnail).
    resp = await client.post("/api/v1/export/jobs?format=cover", content=json.dumps(_BOOK))
    assert resp.status_code == 422


async def test_submit_rejects_bad_book_up_front(client):
    resp = await client.post("/api/v1/export/jobs?format=epub", content=b'{"title": "X"}')
    assert resp.status_code == 422
    assert "table of contents" in resp.json()["detail"]


async def test_submit_rejects_oversized_body(client):
    big = b"x" * (25 * 1024 * 1024 + 1)
    resp = await client.post("/api/v1/export/jobs?format=epub", content=big)
    assert resp.status_code == 413


async def test_status_404_for_unknown_job(client):
    resp = await client.get(f"/api/v1/export/jobs/{uuid.uuid4()}")
    assert resp.status_code == 404


async def test_artifact_404_for_unknown_job(client):
    resp = await client.get(f"/api/v1/export/jobs/{uuid.uuid4()}/artifact")
    assert resp.status_code == 404


# ── real end-to-end (auto-skips unless the Node compiler is built) ───────────
_HAVE_COMPILER = bool(shutil.which(settings.node_bin)) and os.path.exists(settings.compiler_cli)


@pytest.mark.skipif(
    not _HAVE_COMPILER, reason="Node compiler not built (run: cd compiler && npm run build)"
)
async def test_async_export_epub_end_to_end_real_compiler(client):
    """Submit → the background task runs the REAL Node compiler → poll → download
    a real EPUB. Exercises the whole async path (no diagrams, so no Chromium)."""
    submit = await client.post("/api/v1/export/jobs?format=epub", content=json.dumps(_BOOK))
    assert submit.status_code == 202
    job_id = submit.json()["job_id"]

    body = await _wait_for_status(client, job_id, timeout=60.0)
    assert body["status"] == "done", body
    assert body["size"] > 1000

    art = await client.get(f"/api/v1/export/jobs/{job_id}/artifact")
    assert art.status_code == 200
    assert art.content[:2] == b"PK"  # a real zip/EPUB
    assert len(art.content) > 1000
