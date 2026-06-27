"""Tests for POST /api/v1/export.

The compiler subprocess is mocked so these run without Node (CI is Python-only).
A real end-to-end test auto-skips unless the Node compiler is built locally.
"""

from __future__ import annotations

import base64
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
def _fake_compile(record: dict, warnings: list[dict] | None = None):
    async def fake(raw: bytes, *, fmt: str = "epub", diagrams: bool = False) -> ExportResult:
        record["fmt"] = fmt
        record["diagrams"] = diagrams
        return ExportResult(
            data=b"%PDF-or-PK-bytes", title="Physics & Friends", warnings=warnings or []
        )

    return fake


async def test_export_epub_by_default(client, monkeypatch):
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec))

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/epub+zip")
    assert resp.headers["content-disposition"] == 'attachment; filename="physics-friends.epub"'
    # Gate 3: a clean book reports zero format-drift warnings on the header.
    assert resp.headers["x-content-warnings"] == "0"
    assert rec == {"fmt": "epub", "diagrams": False}


async def test_export_surfaces_format_warning_count_header(client, monkeypatch):
    rec: dict = {}
    drift = [{"rule": "expected_table", "topic_id": "u1"}, {"rule": "expected_formula"}]
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec, warnings=drift))

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["x-content-warnings"] == "2"


async def test_export_pdf_with_diagrams(client, monkeypatch):
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec))

    resp = await client.post("/api/v1/export?format=pdf&diagrams=true", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.headers["content-disposition"] == 'attachment; filename="physics-friends.pdf"'
    assert rec == {"fmt": "pdf", "diagrams": True}


async def test_export_cover_png(client, monkeypatch):
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec))

    resp = await client.post("/api/v1/export?format=cover", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("image/png")
    assert resp.headers["content-disposition"] == 'attachment; filename="physics-friends.png"'
    assert rec == {"fmt": "cover", "diagrams": False}


# ── Content Trust Manifest header (SBQ-TRUST-002) ────────────────────────────
def _decode_manifest(resp) -> dict:
    header = resp.headers["x-content-trust-manifest"]
    return json.loads(base64.b64decode(header).decode())


async def test_export_attaches_trust_manifest_header(client, monkeypatch):
    # AC1: a compiled book carries X-Content-Trust-Manifest (base64 JSON) with
    # provenance + validation (from generation) and compliance + integrity (from
    # export).
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec))

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    m = _decode_manifest(resp)
    assert m["trust_manifest_version"] == 1
    assert m["provenance"]["provider"] == "anthropic"
    assert m["validation"]["schema_validated"] is True
    assert m["compliance"]["ruleset"] == "mentible-professional@1.0"
    assert m["integrity"]["content_hash"].startswith("sha256:")
    # AC7: no key material in the manifest header.
    assert "api_key" not in resp.headers["x-content-trust-manifest"].lower()


async def test_trust_manifest_hash_is_stable_across_compiles(client, monkeypatch):
    # AC2: two compiles of the same book.json yield the same integrity hash.
    monkeypatch.setattr(compiler, "compile_book", _fake_compile({}))
    a = _decode_manifest(await client.post("/api/v1/export", content=json.dumps(_BOOK)))
    b = _decode_manifest(await client.post("/api/v1/export", content=json.dumps(_BOOK)))
    assert a["integrity"]["content_hash"] == b["integrity"]["content_hash"]


async def test_cover_export_has_no_trust_manifest(client, monkeypatch):
    # The cover thumbnail is not a content artifact — no manifest is attached.
    monkeypatch.setattr(compiler, "compile_book", _fake_compile({}))
    resp = await client.post("/api/v1/export?format=cover", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert "x-content-trust-manifest" not in resp.headers


async def test_export_succeeds_even_if_trust_assembly_fails(client, monkeypatch):
    # Trust assembly is best-effort: a failure inside it never blocks the export.
    rec: dict = {}
    monkeypatch.setattr(compiler, "compile_book", _fake_compile(rec))
    monkeypatch.setattr(
        "backend.src.export.trust.export_manifest",
        lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert "x-content-trust-manifest" not in resp.headers


async def test_export_rejects_unknown_format(client, monkeypatch):
    called = False

    async def fake(raw, *, fmt="epub", diagrams=False):
        nonlocal called
        called = True
        return ExportResult(data=b"", title="x", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export?format=mobi", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "epub" in resp.json()["detail"]
    assert called is False


async def test_export_validation_error_is_422(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False):
        raise ExportValidationError("Book has no generated content to compile.")

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "no generated content" in resp.json()["detail"]


async def test_export_compiler_error_is_500_without_internals(client, monkeypatch):
    async def fake(raw, *, fmt="epub", diagrams=False):
        raise CompilerError("node exploded: /secret/path/stacktrace")

    monkeypatch.setattr(compiler, "compile_book", fake)

    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 500
    assert resp.json()["detail"] == "Could not compile the book."
    assert "secret" not in resp.text


async def test_export_rejects_oversized_body(client, monkeypatch):
    called = False

    async def fake(raw, *, fmt="epub", diagrams=False):
        nonlocal called
        called = True
        return ExportResult(data=b"", title="x", warnings=[])

    monkeypatch.setattr(compiler, "compile_book", fake)

    big = b"x" * (25 * 1024 * 1024 + 1)
    resp = await client.post("/api/v1/export", content=big)
    assert resp.status_code == 413
    assert called is False


# ── real end-to-end (auto-skips unless the Node compiler is built) ───────────
_HAVE_COMPILER = bool(shutil.which(settings.node_bin)) and os.path.exists(settings.compiler_cli)


@pytest.mark.skipif(
    not _HAVE_COMPILER, reason="Node compiler not built (run: cd compiler && npm run build)"
)
async def test_export_epub_end_to_end_real_compiler(client):
    resp = await client.post("/api/v1/export", content=json.dumps(_BOOK))
    assert resp.status_code == 200
    assert resp.content[:2] == b"PK"  # a real zip/EPUB
    assert len(resp.content) > 1000
