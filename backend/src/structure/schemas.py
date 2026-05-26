"""Request/response schemas for POST /structure (book-authoring Phase 1).

`/structure` turns a free-text table of contents into a structured topic tree.
It follows the exact same BYOK discipline as /generate (ADR-001): the user's
api_key rides in the request body, is enveloped into Redis, used once by the
worker, and shredded. The job result is a StructuredTOC.

The job-status shape is shared with /generate — clients poll the same
GET /api/v1/jobs/{job_id} endpoint regardless of which job kind they submitted.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class StructureRequest(BaseModel):
    """Body of POST /structure.

    NOTE: `api_key` carries the user's BYOK Anthropic key — handled with the
    ADR-001 discipline (never logged, never persisted in plaintext, only stored
    encrypted in Redis with a per-job envelope and a short TTL).
    """

    # Idempotency key — client-generated UUID4. A duplicate submit within the
    # idempotency window returns the original job_id (no second Anthropic bill).
    request_id: uuid.UUID

    # The author's pasted free-text TOC. Generous cap — a textbook index can
    # be long, but this is a single structuring call, not a full book.
    raw_toc: str = Field(min_length=1, max_length=20000)

    # Optional grade context (1–18, grade-equivalent) included in the prompt.
    grade: int | None = Field(default=None, ge=1, le=18)

    # BYOK key — sk-ant-... . Length-validated here; Anthropic rejects malformed
    # keys at call time.
    api_key: str = Field(min_length=20, max_length=512)

    # Optional model override — defaults to settings.anthropic_default_model.
    model: str | None = None

    @field_validator("api_key")
    @classmethod
    def _api_key_shape(cls, v: str) -> str:
        if not v.startswith("sk-ant-"):
            raise ValueError("api_key must be an Anthropic API key (starts with sk-ant-)")
        return v


class StructureResponse(BaseModel):
    """Body of 202 Accepted from POST /structure."""

    job_id: uuid.UUID
    status: Literal["queued"]
