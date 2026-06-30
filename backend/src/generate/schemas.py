"""Request/response schemas for /generate endpoints.

Validation runs at the FastAPI boundary. Internal calls trust their callers.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from wegofwd_llm.registry import PROVIDER_REGISTRY

# Output formats for v1 (D13). MVP uses only "lesson" — others land in v1.1.
OutputFormat = Literal["lesson", "explanation", "quiz"]

# Level dropdown values (D15).
Level = Literal["student", "professional", "expert"]

# Languages (D15). MVP is English-only; v1.1 adds fr/es.
Language = Literal["en", "fr", "es"]

# Diagram register — the "diagram direction" of the publication. Steers what KIND
# of diagrams the model produces (see prompt_builder._DIAGRAM_REGISTERS). Mirrors
# the mobile DiagramRegister type (mobile/src/types/generationParams.ts).
DiagramRegister = Literal["conceptual", "balanced", "technical"]


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

    # Diagram direction — what kind of diagrams to favour (conceptual ↔ technical).
    # Defaults to "balanced" so existing clients are unaffected.
    diagram_register: DiagramRegister = "balanced"

    # Target length in pages for this lesson's prose (excludes quizzes/answers).
    # 0 (default) = no explicit target — let depth + the model decide ("as much
    # as possible"). The mobile client divides a whole-book page target evenly
    # across topics, so this is the per-lesson share. Upper bound is generous;
    # the worker clamps the resulting max_tokens to the model ceiling anyway.
    target_pages: int = Field(default=0, ge=0, le=100)

    # Free-text author guidance applied on (re)generation — e.g. "add a diagram
    # for the T-shape". Persisted per topic on the client and re-sent each time.
    instructions: str | None = Field(default=None, max_length=2000)

    # BYOK key — its prefix is validated per provider (see _api_key_matches_provider).
    # OPTIONAL (ADR-005 D6): omit it for the managed path, where the server resolves
    # OUR key by eligibility instead of the user supplying one. A keyless request from
    # an ineligible/anonymous caller is rejected by the router (not "no auth").
    api_key: str | None = Field(default=None, min_length=20, max_length=512)

    # Which LLM to generate with (BYOK). Defaults to Anthropic so existing
    # clients are unaffected. Must be a known provider (see the registry).
    provider_id: str = "anthropic"

    # Optional model override — defaults to the provider's registry default
    # (anthropic → settings.anthropic_default_model).
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider_id {v!r}")
        return v

    @model_validator(mode="after")
    def _api_key_matches_provider(self) -> GenerateRequest:
        # Managed path: no BYOK key in the body — the server resolves OUR key by
        # eligibility (ADR-005 D6). Nothing to prefix-check.
        if self.api_key is None:
            return self
        # BYOK keys are scoped to their provider — never send the wrong format.
        # Each provider declares its expected key prefix in the registry
        # (anthropic sk-ant-, openai/deepseek sk-, groq gsk_, openrouter sk-or-,
        # gemini "" = no prefix check). An empty prefix means length-only.
        prefix = PROVIDER_REGISTRY[self.provider_id].key_prefix
        if prefix and not self.api_key.startswith(prefix):
            raise ValueError(f"{self.provider_id} api_key must start with {prefix}")
        return self


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
    # Content Trust Manifest (ADR-015): provenance + validation + policy at
    # generation; compliance + integrity attach later at export (SBQ-TRUST-002).
    # Present on a done job. Shape validated by
    # wegofwd-llm/schema/content-trust-manifest.v1.json. The provenance block lets
    # the client detect content made with an outdated model and offer to
    # regenerate. Carries no key material (guaranteed by to_public_dict()).
    trust: dict | None = None
    # Non-fatal format-drift warnings from gate 3 (content_format_validator). A
    # done job with warnings is still valid content; the warnings are a review /
    # prompt-drift signal. Absent or empty when the content looks clean.
    warnings: list[dict] | None = None
    # Observed token usage for this generation (SBQ-USAGE-001). Metadata only — no
    # key, no content. Keys: provider, model, input_tokens, output_tokens (summed
    # across repair attempts), tokens_estimated, attempts. The client appends this
    # to a device-local usage ledger; nothing is persisted server-side.
    usage: dict | None = None
