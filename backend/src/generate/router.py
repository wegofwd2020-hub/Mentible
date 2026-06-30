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
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from wegofwd_llm.registry import PROVIDER_REGISTRY, provenance

from backend.config import settings
from backend.src.accounts import repo as accounts_repo
from backend.src.auth.deps import optional_user
from backend.src.auth.principal import Principal
from backend.src.billing import access
from backend.src.billing.eligibility import is_managed_eligible
from backend.src.core.byok_envelope import encrypt_api_key, parse_master_key
from backend.src.core.log_redaction import get_logger
from backend.src.core.rate_limit import enforce_rate_limit
from backend.src.core.redis_dep import get_redis
from backend.src.generate.schemas import (
    GenerateRequest,
    GenerateResponse,
    JobStatusResponse,
)
from backend.src.generate.tasks import run_generation

router = APIRouter(prefix="/api/v1", tags=["generate"])
log = get_logger("generate")

# Re-exported for back-compat: callers (structure router, conftest) import
# `get_redis` from here. The definition now lives in core.redis_dep so the
# rate-limit dependency can share it without an import cycle.
__all__ = ["get_redis", "router"]


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
    dependencies=[Depends(enforce_rate_limit)],
)
async def submit_generate(
    body: GenerateRequest,
    background: BackgroundTasks,
    request: Request,
    r: redis.Redis = Depends(get_redis),
    principal: Principal | None = Depends(optional_user),
) -> GenerateResponse:
    """Submit a generation request.

    1. Idempotency check on request_id — duplicate within window returns the
       original job_id.
    2. Resolve the key path: BYOK (key in body) or managed (eligible caller, no key).
    3. Generate a fresh job_id.
    4. BYOK only — encrypt the api_key into Redis (per-job envelope). Managed jobs
       store no key; the worker reads OUR vault key (ADR-005 D6).
    5. Record initial status "queued" + the idempotency record.
    6. Dispatch the background generation task.
    7. Return 202 with job_id.
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

    # ── 2. Resolve key path: BYOK vs managed (ADR-005 D6) ────────────────────
    # A key in the body ⇒ BYOK (explicit, unchanged — works even for authed users).
    # No key ⇒ managed: only for an eligible caller, else reject (a generic 400 that
    # does not reveal allowlist membership). The managed key is OUR vault key, read
    # in the worker — it never enters this request or Redis.
    managed = body.api_key is None
    account_id = None
    db_pool = getattr(request.app.state, "db", None)
    if managed:
        # With the account store (the authed managed case): resolve the account's managed
        # access — a plan entitlement or the staff override (Phase 3) — and refuse BEFORE
        # spending if ineligible (400) or over the plan's allowance (429). Without a DB
        # (demo / no-store path) only the staff allowlist applies, unmetered.
        if db_pool is not None and principal is not None:
            async with db_pool.acquire() as conn:
                account = await accounts_repo.get_or_create_account(
                    conn, idp_sub=principal.sub, email=principal.email
                )
                account_id = account.id
                grant = await access.resolve_managed_access(
                    conn,
                    account_id=account_id,
                    provider_id=body.provider_id,
                    principal=principal,
                )
                if grant is None:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="an api_key is required for this request",
                    )
                if await access.over_cap(conn, account_id=account_id, access=grant):
                    log.info("managed_cap_exceeded", request_id=str(body.request_id))
                    raise HTTPException(
                        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                        detail="managed allowance exhausted; try again later or add your own key",
                    )
        elif not is_managed_eligible(principal, body.provider_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="an api_key is required for this request",
            )

    # ── 3. Fresh job ─────────────────────────────────────────────────────────
    job_id = uuid.uuid4()

    # ── 4. BYOK only: encrypt + store envelope ───────────────────────────────
    if not managed:
        master_key = parse_master_key(settings.byok_master_key)
        envelope = encrypt_api_key(master_key, str(job_id), body.api_key)
        await r.setex(
            _byok_redis_key(job_id),
            settings.byok_redis_ttl_seconds,
            envelope,
        )

    # ── 5. Initial status ────────────────────────────────────────────────────
    await r.setex(
        _job_status_redis_key(job_id),
        settings.byok_redis_ttl_seconds * 10,
        json.dumps({"status": "queued"}),
    )

    # ── 6. Idempotency record ────────────────────────────────────────────────
    # Holds longer than envelope so retries that arrive after envelope expiry
    # still get the same job_id mapped (and see status = done/failed/expired).
    await r.setex(
        idem_key,
        settings.byok_redis_ttl_seconds * 10,
        str(job_id).encode("utf-8"),
    )

    # ── 7. Dispatch background task ──────────────────────────────────────────
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
        managed=managed,
        account_id=account_id,
        db_pool=db_pool,
        redis_client=r,
    )

    # Safe-surface logging only — never the api_key, never the request body.
    # `managed` is a safe boolean (no key material).
    log.info(
        "generate_submitted",
        job_id=str(job_id),
        request_id=str(body.request_id),
        topic_len=len(body.topic),
        format=body.format,
        level=body.level,
        language=body.language,
        managed=managed,
    )

    return GenerateResponse(job_id=job_id, status="queued")


@router.get("/registry/current")
async def registry_current(
    response: Response,
    provider: str = "anthropic",
    model: str | None = None,
) -> dict:
    """Current resolved provenance for a book's LLM config — the pin-or-default
    model plus the version axes (`integration_version`, `contract_version`).

    Lets the client diff a stored unit's provenance against what's current and
    flag stale content (ADR-016 D7 / SBQ-TRUST-004). Pass the book's pinned
    `generationParams.model` as `model` so the returned `model` reflects the pin;
    omit it for the provider default. Key-free public registry metadata — no BYOK
    key, no generation. 404 on an unknown provider (never a silent default)."""
    if provider not in PROVIDER_REGISTRY:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown provider {provider!r}",
        )
    # The registry changes only on deploy → safe to cache for an hour.
    response.headers["Cache-Control"] = "public, max-age=3600"
    return provenance(provider, model)


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
        trust=payload.get("trust"),
        warnings=payload.get("warnings"),
        usage=payload.get("usage"),
    )
