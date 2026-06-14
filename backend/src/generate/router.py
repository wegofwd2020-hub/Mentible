"""POST /generate and GET /jobs/{job_id} for StudyBuddy Q.

Flow:
- POST /generate validates → checks idempotency on request_id → envelopes the
  api_key into Redis → records status="queued" → dispatches a BackgroundTask
  → returns 202 with job_id.
- The background task (`tasks.run_generation`) decrypts the envelope, calls
  Anthropic, validates the response, writes status=done|failed, and shreds
  the envelope.
- GET /jobs/{job_id} returns the recorded status.

The handler NEVER logs the request body verbatim — it contains api_key.
Logs surface only safe fields (job_id, request_id, topic_len, format, level).
"""

from __future__ import annotations

import json
import uuid

import redis.asyncio as redis
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status

from backend.config import settings
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.core.log_redaction import get_logger
from backend.src.generate.schemas import (
    GenerateRequest,
    GenerateResponse,
    JobStatusResponse,
)
from backend.src.generate.tasks import run_generation

router = APIRouter(prefix="/api/v1", tags=["generate"])
log = get_logger("generate")


# ── Redis dependency ──────────────────────────────────────────────────────────


async def get_redis() -> redis.Redis:
    """Return a Redis client. In production this is overridden by the
    lifespan-managed pool; the default is fine for local dev and tests
    that fall through to a real fakeredis-backed client."""
    return redis.from_url(settings.redis_url, decode_responses=False)


# ── Redis key helpers ─────────────────────────────────────────────────────────


def _byok_redis_key(job_id: uuid.UUID) -> str:
    return f"byok:{job_id}"


def _job_status_redis_key(job_id: uuid.UUID) -> str:
    return f"job:{job_id}:status"


def _idempotency_redis_key(request_id: uuid.UUID) -> str:
    """Maps a client-supplied request_id → the job_id we already created for it.

    Used to dedup duplicate POST /generate calls within an idempotency window
    so a client retry doesn't trigger a second Anthropic call (and a second
    bill on the user's account).
    """
    return f"req:{request_id}"


# ── Endpoints ─────────────────────────────────────────────────────────────────


@router.post(
    "/generate",
    response_model=GenerateResponse,
    status_code=status.HTTP_202_ACCEPTED,
)
async def submit_generate(
    body: GenerateRequest,
    background: BackgroundTasks,
    r: redis.Redis = Depends(get_redis),
) -> GenerateResponse:
    """Submit a generation request.

    1. Idempotency check on request_id — duplicate within window returns the
       original job_id.
    2. Generate a fresh job_id.
    3. Encrypt the api_key into Redis (per-job envelope).
    4. Record initial status "queued".
    5. Dispatch the background generation task.
    6. Return 202 with job_id.
    """
    # ── 1. Idempotency dedup ─────────────────────────────────────────────────
    idem_key = _idempotency_redis_key(body.request_id)
    existing = await r.get(idem_key)
    if existing is not None:
        existing_job_id = uuid.UUID(existing.decode("utf-8"))
        log.info(
            "generate_idempotency_hit",
            job_id=str(existing_job_id),
            request_id=str(body.request_id),
        )
        return GenerateResponse(job_id=existing_job_id, status="queued")

    # ── 2. Fresh job ─────────────────────────────────────────────────────────
    job_id = uuid.uuid4()

    # ── 3. Encrypt + store envelope ──────────────────────────────────────────
    master_key = parse_master_key(settings.byok_master_key)
    envelope = encrypt_api_key(master_key, str(job_id), body.api_key)

    await r.setex(
        _byok_redis_key(job_id),
        settings.byok_redis_ttl_seconds,
        envelope,
    )

    # ── 4. Initial status ────────────────────────────────────────────────────
    await r.setex(
        _job_status_redis_key(job_id),
        settings.byok_redis_ttl_seconds * 10,
        json.dumps({"status": "queued"}),
    )

    # ── 5. Idempotency record ────────────────────────────────────────────────
    # Holds longer than envelope so retries that arrive after envelope expiry
    # still get the same job_id mapped (and see status = done/failed/expired).
    await r.setex(
        idem_key,
        settings.byok_redis_ttl_seconds * 10,
        str(job_id).encode("utf-8"),
    )

    # ── 6. Dispatch background task ──────────────────────────────────────────
    background.add_task(
        run_generation,
        job_id=job_id,
        topic=body.topic,
        level=body.level,
        language=body.language,
        format=body.format,
        depth=body.depth,
        target_pages=body.target_pages,
        diagram_register=body.diagram_register,
        prior_knowledge=body.prior_knowledge,
        framing=body.framing,
        instructions=body.instructions,
        provider_id=body.provider_id,
        model=body.model,
        redis_client=r,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    log.info(
        "generate_submitted",
        job_id=str(job_id),
        request_id=str(body.request_id),
        topic_len=len(body.topic),
        format=body.format,
        level=body.level,
        language=body.language,
    )

    return GenerateResponse(job_id=job_id, status="queued")


@router.get(
    "/jobs/{job_id}",
    response_model=JobStatusResponse,
)
async def get_job_status(
    job_id: uuid.UUID,
    r: redis.Redis = Depends(get_redis),
) -> JobStatusResponse:
    """Return the status of a previously submitted job."""
    raw = await r.get(_job_status_redis_key(job_id))
    if raw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="job not found")

    payload = json.loads(raw)
    return JobStatusResponse(
        job_id=job_id,
        status=payload.get("status", "queued"),
        error=payload.get("error"),
        result=payload.get("result"),
        provenance=payload.get("provenance"),
        warnings=payload.get("warnings"),
    )
