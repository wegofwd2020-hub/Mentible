"""POST /structure — free-text TOC → structured topic tree (book authoring).

Submit flow mirrors POST /generate exactly (idempotency → envelope the api_key
into Redis → record status="queued" → dispatch a BackgroundTask → 202). Clients
poll the shared GET /api/v1/jobs/{job_id} endpoint (defined in the generate
router) for the result; a structure job's result is a StructuredTOC.

The handler NEVER logs the request body verbatim — it contains api_key. Logs
surface only safe fields (job_id, request_id, toc_len, grade).
"""

from __future__ import annotations

import json
import uuid

import redis.asyncio as redis
from fastapi import APIRouter, BackgroundTasks, Depends, status

from backend.config import settings
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.core.log_redaction import get_logger

# Reuse the generate router's Redis dependency so a single override (tests) and
# a single lifespan-managed pool cover both endpoints.
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.core.redis_dep import get_redis
from backend.src.generate.router import (
    _byok_redis_key,
    _idempotency_redis_key,
    _job_status_redis_key,
)
from backend.src.structure.schemas import StructureRequest, StructureResponse
from backend.src.structure.tasks import run_structure

router = APIRouter(prefix="/api/v1", tags=["structure"])
log = get_logger("structure")


@router.post(
    "/structure",
    response_model=StructureResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_structure(
    body: StructureRequest,
    background: BackgroundTasks,
    r: redis.Redis = Depends(get_redis),
) -> StructureResponse:
    """Submit a TOC-structuring request. See module docstring for the flow."""
    # ── 1. Idempotency dedup ─────────────────────────────────────────────────
    idem_key = _idempotency_redis_key(body.request_id)
    existing = await r.get(idem_key)
    if existing is not None:
        existing_job_id = uuid.UUID(existing.decode("utf-8"))
        log.info(
            "structure_idempotency_hit",
            job_id=str(existing_job_id),
            request_id=str(body.request_id),
        )
        return StructureResponse(job_id=existing_job_id, status="queued")

    # ── 2. Fresh job ─────────────────────────────────────────────────────────
    job_id = uuid.uuid4()

    # ── 3. Encrypt + store envelope ──────────────────────────────────────────
    master_key = parse_master_key(settings.byok_master_key)
    envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
    await r.setex(_byok_redis_key(job_id), settings.byok_redis_ttl_seconds, envelope)

    # ── 4. Initial status ────────────────────────────────────────────────────
    await r.setex(
        _job_status_redis_key(job_id),
        settings.byok_redis_ttl_seconds * 10,
        json.dumps({"status": "queued"}),
    )

    # ── 5. Idempotency record ────────────────────────────────────────────────
    await r.setex(
        idem_key,
        settings.byok_redis_ttl_seconds * 10,
        str(job_id).encode("utf-8"),
    )

    # ── 6. Dispatch background task ──────────────────────────────────────────
    background.add_task(
        run_structure,
        job_id=job_id,
        raw_toc=body.raw_toc,
        grade=body.grade,
        model=body.model,
        redis_client=r,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    log.info(
        "structure_submitted",
        job_id=str(job_id),
        request_id=str(body.request_id),
        toc_len=len(body.raw_toc),
        grade=body.grade,
    )

    return StructureResponse(job_id=job_id, status="queued")
