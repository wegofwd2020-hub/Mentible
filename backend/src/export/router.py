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

import asyncio
import json
import re
import uuid
from base64 import b64encode

import redis.asyncio as redis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.core.redis_dep import get_redis
from backend.src.export import compiler
from backend.src.export import tasks as export_tasks
from backend.src.export import trust as export_trust
from backend.src.export.schemas import ExportJobStatusResponse, ExportSubmitResponse

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

    headers = {
        "Content-Disposition": f'attachment; filename="{_filename(result.title, ext)}"',
        # Gate 3: count of non-fatal format-drift warnings over the book's
        # content (0 when clean). A review / prompt-drift signal the client
        # can surface without parsing the artifact. Details are logged.
        "X-Content-Warnings": str(len(result.warnings)),
    }

    # Attach the book-level Content Trust Manifest (ADR-015 / SBQ-TRUST-002):
    # compliance (mentible-professional@1.0) + integrity (content_hash) over the
    # compiled artifact. Only for content artifacts (not the cover thumbnail). The
    # manifest is non-secret (to_public_dict), so a base64 header is safe. Best
    # effort — never block a successful export over trust assembly.
    if fmt in ("epub", "pdf"):
        try:
            book = json.loads(raw)
            manifest = await asyncio.to_thread(export_trust.export_manifest, book, result.data)
            headers["X-Content-Trust-Manifest"] = b64encode(
                json.dumps(manifest.to_public_dict()).encode()
            ).decode()
        except Exception:
            # raw parsed inside compile_book already, so this is unexpected; log
            # and ship the artifact without the manifest header.
            log.warning("trust_manifest_failed", fmt=fmt)

    return Response(content=result.data, media_type=media_type, headers=headers)


# ── Async export jobs ─────────────────────────────────────────────────────────
# The synchronous handler above stays for `cover` (a sub-second thumbnail) and any
# legacy caller. The endpoints below decouple the (minutes-long, diagram-rendering)
# EPUB/PDF compile from the HTTP request so no single request outlives Cloudflare's
# ~100s proxy timeout — submit → poll → download, each call fast. See tasks.py.

_ASYNC_FORMATS = {"epub", "pdf"}


@router.post(
    "/export/jobs",
    response_model=ExportSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_export(
    request: Request,
    background: BackgroundTasks,
    format: str = "epub",
    diagrams: bool = False,
    r: redis.Redis = Depends(get_redis),
) -> ExportSubmitResponse:
    """Submit a book for async compilation. Returns 202 + job_id; poll
    GET /export/jobs/{id} then download /export/jobs/{id}/artifact.

    Validation that is cheap and definitive (format, size, obvious bad JSON) runs
    synchronously so the client still gets an immediate 4xx; the slow compile is
    deferred to the background task."""
    fmt = format.lower()
    if fmt not in _ASYNC_FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub' or 'pdf'."},
        )

    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            content={"detail": "Book is too large to export."},
        )
    # Reject obvious bad input up front (mirrors the sync path's early 422) so the
    # client learns immediately instead of by polling a failed job.
    try:
        compiler.validate_book(raw)
    except compiler.ExportValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": str(exc)},
        )

    job_id = uuid.uuid4()
    await r.setex(
        export_tasks.export_status_key(job_id),
        settings.export_artifact_ttl_seconds,
        json.dumps({"status": "queued"}),
    )
    background.add_task(
        export_tasks.run_export,
        job_id=job_id,
        raw_book=raw,
        fmt=fmt,
        diagrams=diagrams,
        redis_client=r,
    )
    log.info("export_submitted", job_id=str(job_id), fmt=fmt, diagrams=diagrams, bytes=len(raw))
    return ExportSubmitResponse(job_id=job_id, status="queued")


@router.get("/export/jobs/{job_id}", response_model=ExportJobStatusResponse)
async def get_export_job(
    job_id: uuid.UUID,
    r: redis.Redis = Depends(get_redis),
) -> ExportJobStatusResponse:
    """Status of an export job. When done, carries the metadata the client needs
    to present + download the artifact (the bytes come from the artifact route)."""
    raw = await r.get(export_tasks.export_status_key(job_id))
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="export job not found")
    payload = json.loads(raw)
    return ExportJobStatusResponse(
        job_id=job_id,
        status=payload.get("status", "queued"),
        error=payload.get("error"),
        title=payload.get("title"),
        filename=payload.get("filename"),
        format=payload.get("format"),
        size=payload.get("size"),
        warnings=payload.get("warnings"),
        trust=payload.get("trust"),
    )


@router.get("/export/jobs/{job_id}/artifact")
async def download_export_artifact(
    job_id: uuid.UUID,
    r: redis.Redis = Depends(get_redis),
) -> Response:
    """Stream a finished job's compiled artifact with the download headers. 404
    until the job is done (or after the artifact TTL expires)."""
    status_raw = await r.get(export_tasks.export_status_key(job_id))
    if status_raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="export job not found")
    payload = json.loads(status_raw)
    if payload.get("status") != "done":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"export job is {payload.get('status', 'queued')}, not ready",
        )

    data = await r.get(export_tasks.export_artifact_key(job_id))
    if data is None:
        # Status says done but the bytes have expired — treat as gone.
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact expired")

    headers = {
        "Content-Disposition": f'attachment; filename="{payload.get("filename", "book")}"',
        "X-Content-Warnings": str(payload.get("warnings", 0)),
    }
    if payload.get("trust"):
        headers["X-Content-Trust-Manifest"] = payload["trust"]
    return Response(
        content=data,
        media_type=payload.get("media_type", "application/octet-stream"),
        headers=headers,
    )
