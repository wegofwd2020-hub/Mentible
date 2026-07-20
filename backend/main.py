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
from backend.src.accounts import router as account_router
from backend.src.admin import router as admin_router
from backend.src.billing import router as billing_router
from backend.src.core.log_redaction import (
    configure_logging,
    get_logger,
    scrub_validation_errors,
)
from backend.src.db.pool import create_pool
from backend.src.export import router as export_router
from backend.src.generate import router as generate_router
from backend.src.library import router as library_router
from backend.src.sharing import router as sharing_router
from backend.src.shelves import router as shelves_router
from backend.src.structure import router as structure_router

# Starlette renamed HTTP_422_UNPROCESSABLE_ENTITY → ..._CONTENT; tolerate both.
_HTTP_422 = (
    getattr(_status, "HTTP_422_UNPROCESSABLE_CONTENT", None)
    or _status.HTTP_422_UNPROCESSABLE_ENTITY
)

configure_logging(settings.log_level)
log = get_logger("main")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    log.info("startup", app_env=settings.app_env)
    app.state.redis = redis.from_url(settings.redis_url, decode_responses=False)
    # Account store (ADR-014). None when DATABASE_URL is unset — account routes 503.
    app.state.db = await create_pool(settings.database_url)
    try:
        yield
    finally:
        log.info("shutdown")
        await app.state.redis.close()
        if app.state.db is not None:
            await app.state.db.close()


app = FastAPI(
    title="StudyBuddy Q",
    description="Purpose-built Anthropic client for self-learners (BYOK).",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — an explicit origin allowlist (settings.cors_allow_origins), plus loopback
# by regex for the Expo web dev server, which picks an arbitrary port. Native apps
# are not subject to CORS; this only constrains browser clients.
#
# allow_credentials stays False (the default, pinned here so it is not turned on by
# accident): the API authenticates with a bearer token the client attaches itself,
# never a cookie. With credentials off, the browser will not attach a victim's
# Authorization header to a cross-origin request from a third-party page.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)


@app.exception_handler(RequestValidationError)
async def _validation_exception_handler(
    _request: Request, exc: RequestValidationError
) -> JSONResponse:
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
app.include_router(account_router.router)
app.include_router(admin_router.router)
app.include_router(billing_router.router)
app.include_router(library_router.router)
app.include_router(sharing_router.router)
app.include_router(shelves_router.router)


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
