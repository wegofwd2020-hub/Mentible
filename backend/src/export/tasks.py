"""Background export task — the worker side of POST /export/jobs.

Runs as a FastAPI BackgroundTask in the same API process, which already bundles
Node + the built compiler + headless Chromium (see backend/Dockerfile). Decoupling
the compile from the HTTP request is what lets a diagram-laden book take minutes
without tripping Cloudflare's ~100s proxy timeout (the 524 the synchronous
`POST /export` path hits): every HTTP call — submit, poll, download — now returns
in well under that window, and the slow compile happens off the request.

Export is deterministic and KEY-FREE: it compiles already-generated content, so
there is no Anthropic key, no Redis envelope, and nothing to shred (unlike
generate/tasks.py). The only Redis state is the job's status row and, on success,
the compiled artifact bytes.

End-to-end shape:
    1. Write status="running".
    2. Compile the book via the Node compiler (compiler.compile_book).
    3. On success: store the artifact bytes (export:{job_id}:artifact) and write
       status="done" with the metadata the client needs (title, filename, size,
       warning count, and the base64 Content Trust Manifest).
    4. On failure: write status="failed" with a SAFE message (no subprocess
       internals, no traceback).

Like the sync path, the book content is never logged.
"""

from __future__ import annotations

import json
import re
import uuid
from base64 import b64encode

import asyncpg
import redis.asyncio as redis

from backend.config import settings
from backend.src.core.log_redaction import get_logger
from backend.src.export import compiler
from backend.src.export import trust as export_trust
from backend.src.library import artifact_store, published_repo

log = get_logger("export.tasks")


# ── Redis key helpers ─────────────────────────────────────────────────────────
# A dedicated `export:` prefix keeps these clear of the generate/structure job
# rows (`job:{id}:status`), which carry a different payload shape.


def export_status_key(job_id: uuid.UUID) -> str:
    return f"export:{job_id}:status"


def export_artifact_key(job_id: uuid.UUID) -> str:
    return f"export:{job_id}:artifact"


_MEDIA_TYPES = {
    "epub": "application/epub+zip",
    "pdf": "application/pdf",
}


def artifact_filename(title: str, fmt: str) -> str:
    slug = re.sub(r"[^a-zA-Z0-9]+", "-", title).strip("-").lower() or "book"
    return f"{slug[:60]}.{fmt}"


async def _write_status(r: redis.Redis, job_id: uuid.UUID, payload: dict) -> None:
    await r.setex(
        export_status_key(job_id),
        settings.export_artifact_ttl_seconds,
        json.dumps(payload),
    )


async def run_export(
    *,
    job_id: uuid.UUID,
    raw_book: bytes,
    fmt: str,
    diagrams: bool,
    redis_client: redis.Redis,
    publish_book_id: str | None = None,
    published_by_sub: str | None = None,
    db_pool: asyncpg.Pool | None = None,
) -> None:
    """Compile a book to an artifact off the request and record the result in Redis.

    Terminal states written to `export:{job_id}:status`:
      done   → {status, title, filename, format, size, warnings, trust?, published?}
      failed → {status, error}  (error is a safe, client-facing message)

    When `publish_book_id` is set (the Open-Library publish path, ADR-027), the
    finished artifact is ALSO written to the durable on-disk store and registered
    in `published_artifact` so readers can see + download it.
    """
    r = redis_client
    try:
        await _write_status(r, job_id, {"status": "running"})
    except Exception:
        # A status write failing at the start is unexpected (Redis just accepted
        # the queued row); log and press on — the compile can still succeed and
        # the done-write below may land.
        log.warning("export_status_write_failed_at_start", job_id=str(job_id))

    try:
        result = await compiler.compile_book(raw_book, fmt=fmt, diagrams=diagrams)
    except compiler.ExportValidationError as exc:
        # User-input problem (mirrors the sync path's 422): the message is safe.
        await _write_status(r, job_id, {"status": "failed", "error": str(exc)})
        return
    except compiler.CompilerError:
        # Never leak subprocess internals to the client; details are logged inside
        # the compiler.
        await _write_status(r, job_id, {"status": "failed", "error": "Could not compile the book."})
        return
    except Exception:
        log.error("export_task_unexpected", job_id=str(job_id))
        await _write_status(r, job_id, {"status": "failed", "error": "Could not compile the book."})
        return

    # Store the artifact bytes for the download endpoint to stream.
    await r.setex(
        export_artifact_key(job_id),
        settings.export_artifact_ttl_seconds,
        result.data,
    )

    payload: dict = {
        "status": "done",
        "title": result.title,
        "filename": artifact_filename(result.title, fmt),
        "format": fmt,
        "media_type": _MEDIA_TYPES.get(fmt, "application/octet-stream"),
        "size": len(result.data),
        # Gate 3 format-drift warning count (0 when clean) — same signal the sync
        # path surfaces via the X-Content-Warnings header.
        "warnings": len(result.warnings),
    }

    # Attach the book-level Content Trust Manifest (ADR-015 / SBQ-TRUST-002),
    # best effort — never fail a compiled artifact over trust assembly.
    try:
        book = json.loads(raw_book)
        manifest = export_trust.export_manifest(book, result.data)
        payload["trust"] = b64encode(json.dumps(manifest.to_public_dict()).encode()).decode()
    except Exception:
        log.warning("export_trust_manifest_failed", job_id=str(job_id), fmt=fmt)

    # Open-Library publish (ADR-027): promote the freshly compiled artifact into
    # the durable store + registry. Best effort — a compiled artifact is still a
    # successful export even if publishing fails; the client sees published=False.
    if publish_book_id and db_pool is not None:
        try:
            path = artifact_store.store_artifact(publish_book_id, fmt, result.data)
            async with db_pool.acquire() as conn:
                await published_repo.upsert(
                    conn,
                    book_id=publish_book_id,
                    fmt=fmt,
                    content_hash=artifact_store.content_hash(result.data),
                    size_bytes=len(result.data),
                    filename=artifact_filename(result.title, fmt),
                    storage_path=path,
                    published_by_sub=published_by_sub,
                )
            payload["published"] = True
        except Exception:
            log.error("export_publish_failed", job_id=str(job_id), book_id=publish_book_id)
            payload["published"] = False

    await _write_status(r, job_id, payload)
    log.info(
        "export_job_done",
        job_id=str(job_id),
        fmt=fmt,
        diagrams=diagrams,
        out_bytes=len(result.data),
        warnings=len(result.warnings),
    )
