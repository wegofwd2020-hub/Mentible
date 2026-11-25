"""Open Library endpoints (ADR-027 / ADR-021 D8) — publish + reader access.

- POST /library/{book_id}/publish  — author publishes a book's EPUB/PDF (auth).
  Reuses the async export job: it compiles off-request and, on success, promotes
  the artifact into the durable store + `published_artifact` registry.
- GET  /library/{book_id}/artifacts — PUBLIC metadata (anon → status/size only,
  ADR-027 D9). Drives reader indicators. No bytes.
- GET  /library/{book_id}/artifacts/{format} — registration-gated download
  (ADR-027 D9 register-to-read): any verified user may fetch the file.
"""

from __future__ import annotations

import json
import uuid

import redis.asyncio as redis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from backend.config import settings
from backend.src.accounts import repo as account_repo
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal
from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.core.redis_dep import get_redis
from backend.src.export import compiler
from backend.src.export import tasks as export_tasks
from backend.src.export.schemas import ExportSubmitResponse
from backend.src.library import artifact_store, commons_repo, published_repo
from backend.src.library.commons_metadata import (
    missing_fields_message,
    missing_publish_fields,
    oversize_publish_fields,
)

router = APIRouter(prefix="/api/v1/library", tags=["library"])
log = get_logger("library")

_MAX_BODY_BYTES = 25 * 1024 * 1024
_FORMATS = {"epub", "pdf"}
_MEDIA_TYPE = {"epub": "application/epub+zip", "pdf": "application/pdf"}


async def _publish_account_name(db_pool, principal: Principal) -> str | None:
    """Account name for the publish gate: the account's editable display name
    (Settings). None when unset or blank, which the gate reports as missing."""
    async with db_pool.acquire() as conn:
        await account_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
        return await account_repo.get_display_name(conn, idp_sub=principal.sub)


@router.post(
    "/{book_id}/publish",
    response_model=ExportSubmitResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def publish_book(
    book_id: str,
    request: Request,
    background: BackgroundTasks,
    format: str = "epub",
    diagrams: bool = True,
    r: redis.Redis = Depends(get_redis),
    principal: Principal = Depends(require_active_user),
) -> ExportSubmitResponse:
    """Publish a book to the Open Library. Body is the book.json; returns a job id
    to poll on GET /export/jobs/{id} (the same async export machinery). On done,
    the artifact is hosted + registered for readers."""
    fmt = format.lower()
    if fmt not in _FORMATS:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": "format must be 'epub' or 'pdf'."},
        )

    db_pool = getattr(request.app.state, "db", None)
    if db_pool is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="the Open Library is not available",
        )

    raw = await request.body()
    if len(raw) > _MAX_BODY_BYTES:
        return JSONResponse(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            content={"detail": "Book is too large to publish."},
        )
    try:
        book = compiler.validate_book(raw)
    except compiler.ExportValidationError as exc:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": str(exc)},
        )

    account_name = await _publish_account_name(db_pool, principal)
    missing = missing_publish_fields(book, account_name)
    if missing:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": missing_fields_message(missing)},
        )

    too_big = oversize_publish_fields(book)
    if too_big:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": too_big},
        )

    # Ownership: the first principal to publish a book_id claims it; nobody else
    # may (re)publish it thereafter (prevents overwriting another author's
    # artifact — IDOR). Checked BEFORE queueing the compile.
    async with db_pool.acquire() as conn:
        owns = await published_repo.claim_or_check_owner(conn, book_id=book_id, sub=principal.sub)
    if not owns:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="this book is published by another account",
        )

    metadata = book.get("metadata") or {}
    commons = {
        "owner_sub": principal.sub,
        "title": book["title"],
        "author_name": metadata["author"],
        "account_name": account_name,
        "description": metadata.get("description"),
        "language": (metadata.get("language") or "").strip() or "en",
        "cover_svg": metadata.get("coverSvg"),
        # One publish = EPUB + PDF: only the EPUB bumps the catalog version.
        "bump_version": fmt == "epub",
    }

    job_id = uuid.uuid4()
    await r.set(
        export_tasks.export_status_key(job_id),
        json.dumps({"status": "queued"}),
        ex=settings.export_artifact_ttl_seconds,
    )
    background.add_task(
        export_tasks.run_export,
        job_id=job_id,
        raw_book=raw,
        fmt=fmt,
        diagrams=diagrams,
        redis_client=r,
        publish_book_id=book_id,
        published_by_sub=principal.sub,
        db_pool=db_pool,
        commons=commons,
    )
    log.info("library_publish_submitted", job_id=str(job_id), book_id=book_id, fmt=fmt)
    return ExportSubmitResponse(job_id=job_id, status="queued")


@router.get("/{book_id}/artifacts")
async def list_artifacts(book_id: str, request: Request) -> dict:
    """PUBLIC per-book artifact metadata (no bytes). Anonymous — this is the
    reader indicator source. Returns {} when nothing is published (or no store)."""
    db_pool = getattr(request.app.state, "db", None)
    if db_pool is None:
        return {}
    async with db_pool.acquire() as conn:
        rows = await published_repo.list_for_book(conn, book_id)
    return {
        row.format: {
            "size_bytes": row.size_bytes,
            "content_hash": row.content_hash,
            "published_at": row.published_at.isoformat(),
        }
        for row in rows
    }


@router.get("/{book_id}/artifacts/{format}")
async def download_artifact(
    book_id: str,
    format: str,
    request: Request,
    principal: Principal = Depends(require_user),
) -> Response:
    """Download a published artifact — registration-gated (ADR-027 D9): any
    verified user may read it. Anonymous callers get 401 from require_user."""
    fmt = format.lower()
    db_pool = getattr(request.app.state, "db", None)
    if db_pool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not published")
    async with db_pool.acquire() as conn:
        entry = await commons_repo.get_entry(conn, book_id)
        if entry is None or entry.status != "live":
            # Hidden (or never listed): refuse before touching the stored bytes.
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not published")
        row = await published_repo.get_one(conn, book_id, fmt)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="not published")

    data = artifact_store.read_artifact(row.storage_path)
    if data is None:
        # Registered but the file is gone (e.g. volume lost) — treat as missing.
        log.error("published_artifact_file_missing", book_id=book_id, fmt=fmt)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="artifact unavailable")

    return Response(
        content=data,
        media_type=_MEDIA_TYPE.get(fmt, "application/octet-stream"),
        headers={"Content-Disposition": f'attachment; filename="{row.filename}"'},
    )
