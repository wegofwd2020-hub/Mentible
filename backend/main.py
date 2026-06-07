"""FastAPI entry point for StudyBuddy Q.

Lifespan wires:
- structlog with the mandatory key-redaction processor (see ADR-001)
- Redis pool (lazy — initialised on first request)

Endpoints:
- /healthz             liveness
- /readyz              readiness (checks Redis)
- /api/v1/generate     submit a generation job
- /api/v1/jobs/{id}    poll job status
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import redis.asyncio as redis
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette import status as _status

from backend.config import settings
from backend.src.core.log_redaction import (
    configure_logging,
    get_logger,
    scrub_validation_errors,
)

# Starlette renamed HTTP_422_UNPROCESSABLE_ENTITY → ..._CONTENT; tolerate both.
_HTTP_422 = getattr(_status, "HTTP_422_UNPROCESSABLE_CONTENT", None) or _status.HTTP_422_UNPROCESSABLE_ENTITY
from backend.src.export import router as export_router
from backend.src.generate import router as generate_router
from backend.src.structure import router as structure_router

configure_logging(settings.log_level)
log = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", app_env=settings.app_env)
    app.state.redis = redis.from_url(settings.redis_url, decode_responses=False)
    try:
        yield
    finally:
        log.info("shutdown")
        await app.state.redis.close()


app = FastAPI(
    title="StudyBuddy Q",
    description="Purpose-built Anthropic client for self-learners (BYOK).",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — permits the Expo web preview (and any localhost port) to call the API.
# The real Android app is not subject to CORS; this only affects browser clients.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)

@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(_request: Request, exc: RequestValidationError) -> JSONResponse:
    """422 handler that scrubs the BYOK key from the echoed request.

    FastAPI's default handler returns the offending `input` in the response body.
    On `/generate` a missing-field error's input is the whole request body — which
    contains the api_key — so the default would hand the key back to the caller.
    We mirror the default 422 shape but run the errors through
    `scrub_validation_errors` first (ADR-001)."""
    return JSONResponse(
        status_code=_HTTP_422,
        content=jsonable_encoder({"detail": scrub_validation_errors(exc.errors())}),
    )


app.include_router(generate_router.router)
app.include_router(structure_router.router)
app.include_router(export_router.router)


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz() -> dict[str, str]:
    try:
        await app.state.redis.ping()
    except Exception:
        # Don't leak the exception detail to the response.
        return {"status": "degraded", "redis": "unreachable"}
    return {"status": "ok", "redis": "ok"}
