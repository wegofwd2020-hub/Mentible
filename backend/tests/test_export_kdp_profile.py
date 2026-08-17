"""Tests for the KDP-clean export profile (docs/specs/kdp-clean-export-profile.md).

Covers `compiler.compile_book`'s `profile` param directly (argv threading,
default omission, and the KdpDraftError → ExportValidationError mapping). The
compiler subprocess is mocked so these run without Node (CI is Python-only).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.src.export import compiler


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
