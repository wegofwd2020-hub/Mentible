"""Invoke the Node artifact compiler (compiler/dist/cli.js) to turn a book.json
into an artifact (EPUB or PDF).

Compilation is deterministic and KEY-FREE — it renders already-generated
content, so there is no Anthropic key, no Redis envelope, and nothing to redact.
The book is streamed to the compiler over stdin and the artifact read back from
stdout; nothing touches disk here, and the book content is never logged.

Deployment note: the runtime must have Node on PATH and the compiler built
(`cd compiler && npm run build`). PDF (Vivliostyle) and diagram rendering
(Mermaid → SVG) additionally need a headless browser + those optional CLIs in
the image — see backend/Dockerfile. The endpoint returns a clean 5xx if a tool
is missing. `diagrams=False` (the default) uses the lightweight placeholder.
"""

from __future__ import annotations

import asyncio
import json
from typing import NamedTuple

from backend.config import settings
from backend.src.core.log_redaction import get_logger

log = get_logger("export")


class ExportValidationError(Exception):
    """The submitted book is not compilable (bad JSON / missing fields / empty)."""


class CompilerError(Exception):
    """The compiler subprocess failed for a reason that is not the user's input."""


class ExportResult(NamedTuple):
    data: bytes  # the compiled artifact (EPUB or PDF bytes)
    title: str


def validate_book(raw: bytes) -> dict:
    """Light structural validation mirroring the mobile import path. The Node
    compiler remains the authority on the full schema; this only catches the
    obvious 4xx cases early (and gives us a title for the filename)."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ExportValidationError("Body is not valid JSON.") from exc
    if not isinstance(data, dict):
        raise ExportValidationError("Expected a book object at the top level.")
    title = data.get("title")
    if not isinstance(title, str) or not title.strip():
        raise ExportValidationError("Book is missing a title.")
    toc = data.get("toc")
    if not isinstance(toc, dict) or not isinstance(toc.get("subjects"), list):
        raise ExportValidationError("Book is missing a table of contents (toc.subjects).")
    return data


async def compile_book(
    raw_book: bytes,
    *,
    fmt: str = "epub",
    diagrams: bool = False,
) -> ExportResult:
    """Compile raw book.json bytes into an artifact (EPUB or PDF) via the Node
    compiler.

    fmt:      "epub" | "pdf". diagrams: render Mermaid → SVG (needs Chromium;
    much slower, so it gets the longer diagram timeout). Raises
    ExportValidationError for bad input, CompilerError otherwise.
    """
    book = validate_book(raw_book)

    argv = [settings.node_bin, settings.compiler_cli, "-", "-o", "-", "--format", fmt]
    if diagrams:
        argv.append("--mermaid")
    # Diagram rendering (108 Chromium passes) is minutes-long; give it room.
    timeout = (
        settings.export_diagram_timeout_seconds if diagrams else settings.export_timeout_seconds
    )

    try:
        proc = await asyncio.create_subprocess_exec(
            *argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
    except (FileNotFoundError, NotADirectoryError) as exc:
        log.error("compiler_unavailable", node_bin=settings.node_bin)
        raise CompilerError("Compiler runtime is unavailable.") from exc

    try:
        stdout, stderr = await asyncio.wait_for(
            proc.communicate(input=raw_book),
            timeout=timeout,
        )
    except TimeoutError as exc:
        proc.kill()
        await proc.wait()
        raise CompilerError("Compilation timed out.") from exc

    if proc.returncode != 0:
        detail = stderr.decode("utf-8", "replace").strip()
        # The compiler prints this for a book with no generated content — that's
        # a user-input problem (422), not a server fault.
        if "no generated content" in detail.lower():
            raise ExportValidationError("Book has no generated content to compile.")
        log.error("compiler_failed", fmt=fmt, returncode=proc.returncode, detail=detail[:500])
        raise CompilerError("Compilation failed.")

    log.info(
        "export_ok",
        fmt=fmt,
        diagrams=diagrams,
        title_len=len(book["title"]),
        subjects=len(book["toc"]["subjects"]),
        out_bytes=len(stdout),
    )
    return ExportResult(data=stdout, title=book["title"])
