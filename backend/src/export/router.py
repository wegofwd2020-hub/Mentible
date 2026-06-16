"""POST /api/v1/export — compile a book.json into a downloadable EPUB.

Unlike /generate and /structure, export is SYNCHRONOUS and KEY-FREE: it compiles
already-generated content, so there is no Anthropic call, no api_key, and no
Redis envelope. It shells out to the Node artifact compiler (see compiler.py).
The request body is the raw book.json and is never logged.

(The default path renders diagrams as a placeholder — no headless Chromium. An
async-job variant with full diagram rendering for large books is a follow-up;
see docs/COMPILE_PIPELINE_PLAN.md.)
"""

from __future__ import annotations

import re

from fastapi import APIRouter, Depends, Request, Response, status
from fastapi.responses import JSONResponse

from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.export import compiler

router = APIRouter(prefix="/api/v1", tags=["export"])
log = get_logger("export")

# Generous ceiling for a large book.json (the migrated 17-topic book is ~1.9 MB).
_MAX_BODY_BYTES = 25 * 1024 * 1024

_FORMATS = {
    "epub": ("application/epub+zip", "epub"),
    "pdf": ("application/pdf", "pdf"),
    # A PNG thumbnail of the book's cover — lets the mobile Library show the real
    # cover (the EPUB carries only the vector cover.svg, which the app can't
    # render on-device).
    "cover": ("image/png", "png"),
}


def _filename(title: str, ext: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower() or "book"
    return f"{slug[:60]}.{ext}"


@router.post("/export", dependencies=[Depends(enforce_rate_limit)])
async def export_book(
    request: Request,
    format: str = "epub",
    diagrams: bool = False,
) -> Response:
    """Compile a book to an artifact. `format`=epub|pdf; `diagrams`=true renders
    Mermaid → SVG (Chromium; much slower)."""
    fmt = format.lower()
    if fmt not in _FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub' or 'pdf'."},
        )
    media_type, ext = _FORMATS[fmt]

    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            content={"detail": "Book is too large to export."},
        )

    try:
        result = await compiler.compile_book(raw, fmt=fmt, diagrams=diagrams)
    except compiler.ExportValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": str(exc)},
        )
    except compiler.CompilerError:
        # Don't leak subprocess internals to the client; details are logged.
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"detail": "Could not compile the book."},
        )

    return Response(
        content=result.data,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{_filename(result.title, ext)}"',
            # Gate 3: count of non-fatal format-drift warnings over the book's
            # content (0 when clean). A review / prompt-drift signal the client
            # can surface without parsing the artifact. Details are logged.
            "X-Content-Warnings": str(len(result.warnings)),
        },
    )
