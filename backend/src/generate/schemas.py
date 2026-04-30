"""Request/response schemas for /generate endpoints.

Validation runs at the FastAPI boundary. Internal calls trust their callers.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator

# Output formats for v1 (D13). MVP uses only "lesson" — others land in v1.1.
OutputFormat = Literal["lesson", "explanation", "quiz"]

# Level dropdown values (D15).
Level = Literal["student", "professional", "expert"]

# Languages (D15). MVP is English-only; v1.1 adds fr/es.
Language = Literal["en", "fr", "es"]


class GenerateRequest(BaseModel):
    """Body of POST /generate.

    NOTE: `api_key` carries the user's BYOK Anthropic API key. This field is
    handled with the discipline described in ADR-001 — never logged, never
    persisted in plaintext, only stored encrypted in Redis with a per-job
    envelope and a short TTL.
    """

    # Idempotency key — client-generated UUID4. Duplicate requests within
    # the idempotency window return the original job_id.
    request_id: uuid.UUID

    topic: str = Field(min_length=1, max_length=500)
    level: Level
    language: Language = "en"
    format: OutputFormat = "lesson"

    # Optional scope dimensions (D15)
    prior_knowledge: str | None = Field(default=None, max_length=2000)
    framing: str | None = Field(default=None, max_length=500)
    depth: Literal["quick", "standard", "deep"] = "standard"

    # BYOK key — sk-ant-... . Validated on length only; format checking
    # happens implicitly when Anthropic rejects malformed keys.
    api_key: str = Field(min_length=20, max_length=512)

    # Optional model override — defaults to settings.anthropic_default_model.
    model: str | None = None

    @field_validator("api_key")
    @classmethod
    def _api_key_shape(cls, v: str) -> str:
        if not v.startswith("sk-ant-"):
            raise ValueError("api_key must be an Anthropic API key (starts with sk-ant-)")
        return v


class GenerateResponse(BaseModel):
    """Body of 202 Accepted from POST /generate."""

    job_id: uuid.UUID
    status: Literal["queued"]


class JobStatusResponse(BaseModel):
    """Body of GET /jobs/{job_id}.

    PR-1 ships only the queued state. PR-2 adds running/done/failed and the
    result payload.
    """

    job_id: uuid.UUID
    status: Literal["queued", "running", "done", "failed"]
    error: str | None = None
    # Result is intentionally untyped at MVP — schema lands in PR-2 with the
    # actual lesson generator.
    result: dict | None = None
