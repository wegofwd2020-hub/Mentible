"""Tests for the KDP-clean export profile (docs/specs/kdp-clean-export-profile.md).

Covers `compiler.compile_book`'s `profile` param directly (argv threading,
default omission, and the KdpDraftError → ExportValidationError mapping), plus
HTTP-layer regression tests pinning the router's profile validation (422 on
kdp+non-epub, 422 on an unknown profile value) so a future refactor can't
silently drop it. The compiler subprocess is mocked / never invoked, so these
run without Node (CI is Python-only).
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.src.export import compiler

# A minimal book — the HTTP-layer profile-rejection tests below all 422 before
# the body is even parsed, so this just needs to be valid JSON.
_BOOK = {
    "id": "11111111-1111-1111-1111-111111111111",
    "title": "Physics & Friends",
    "toc": {"subjects": [{"subject_label": "Mechanics", "units": []}]},
    "createdAt": "2026-05-27T00:00:00.000Z",
    "updatedAt": "2026-05-27T00:00:00.000Z",
}


async def test_compile_book_rejects_unknown_profile():
    with pytest.raises(compiler.ExportValidationError):
        await compiler.compile_book(b'{"title":"t","toc":{"subjects":[]}}', profile="bogus")


async def test_compile_book_appends_profile_kdp_to_argv():
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(return_value=(b"EPUBBYTES", b""))
    mock_proc.returncode = 0
    with patch(
        "backend.src.export.compiler.asyncio.create_subprocess_exec",
        AsyncMock(return_value=mock_proc),
    ) as create_exec:
        await compiler.compile_book(
            b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
            profile="kdp",
        )
    argv = create_exec.call_args.args
    assert "--profile" in argv
    assert argv[argv.index("--profile") + 1] == "kdp"


async def test_compile_book_default_profile_omits_the_flag():
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(return_value=(b"EPUBBYTES", b""))
    mock_proc.returncode = 0
    with patch(
        "backend.src.export.compiler.asyncio.create_subprocess_exec",
        AsyncMock(return_value=mock_proc),
    ) as create_exec:
        await compiler.compile_book(
            b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
        )
    argv = create_exec.call_args.args
    assert "--profile" not in argv


async def test_compile_book_maps_kdp_draft_error_to_validation_error():
    mock_proc = MagicMock()
    mock_proc.communicate = AsyncMock(
        return_value=(
            b"",
            b'The KDP export profile requires a released book (metadata.status must not be "draft").',
        )
    )
    mock_proc.returncode = 1
    with patch(
        "backend.src.export.compiler.asyncio.create_subprocess_exec",
        AsyncMock(return_value=mock_proc),
    ):
        with pytest.raises(compiler.ExportValidationError, match="released book"):
            await compiler.compile_book(
                b'{"title":"t","toc":{"subjects":[{"subject_label":"s","units":[]}]}}',
                profile="kdp",
            )


# ── HTTP layer: pin the router's profile validation (regression, review round 1) ──
#
# All four checks below fire in export_book / submit_export BEFORE the request
# body is even read (they sit ahead of `raw = await request.body()`), so they
# need no auth, no DB, and no compiler mock — an anonymous request via the
# plain `client` fixture (see conftest.py) is enough. Without a test pinning
# this, a future refactor could reorder/drop the check and silently ship a
# plain (non-KDP) PDF instead of a 422.


async def test_sync_export_rejects_kdp_profile_for_pdf(client):
    resp = await client.post("/api/v1/export?format=pdf&profile=kdp", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "kdp" in resp.json()["detail"].lower()
    assert "epub" in resp.json()["detail"].lower()


async def test_async_export_rejects_kdp_profile_for_pdf(client):
    resp = await client.post(
        "/api/v1/export/jobs?format=pdf&profile=kdp", content=json.dumps(_BOOK)
    )
    assert resp.status_code == 422
    assert "kdp" in resp.json()["detail"].lower()
    assert "epub" in resp.json()["detail"].lower()


async def test_sync_export_rejects_kdp_profile_for_docx(client):
    resp = await client.post("/api/v1/export?format=docx&profile=kdp", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "kdp" in resp.json()["detail"].lower()
    assert "epub" in resp.json()["detail"].lower()


async def test_sync_export_rejects_unknown_profile_value(client):
    resp = await client.post("/api/v1/export?format=epub&profile=bogus", content=json.dumps(_BOOK))
    assert resp.status_code == 422
    assert "profile" in resp.json()["detail"].lower()
