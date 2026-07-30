"""Request/response schemas for /derivatives endpoints (ADR-037 D8).

Validation runs at the FastAPI boundary. Internal calls trust their callers.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from wegofwd_llm.registry import PROVIDER_REGISTRY

# Supported destination platforms for a derivative post.
Platform = Literal["linkedin", "x"]


class DerivativeRequest(BaseModel):
    """Body of POST /derivatives — generate platform-scoped promotional posts.

    NOTE: `api_key` carries the user's BYOK key for the chosen provider. It is
    handled with the same discipline as `generate.schemas.GenerateRequest.api_key`
    (ADR-001) — never logged, never persisted in plaintext.
    """

    source_text: str = Field(min_length=1, max_length=20000)
    platform: Platform = "linkedin"
    tone: str | None = None

    # BYOK key — its prefix is validated per provider (see _api_key_matches_provider).
    # OPTIONAL (ADR-005 D6): omit it for the managed path.
    api_key: str | None = Field(default=None, min_length=20, max_length=512)

    # Which LLM to generate with (BYOK). Defaults to Anthropic so existing
    # clients are unaffected. Must be a known provider (see the registry).
    provider_id: str = "anthropic"

    # Optional model override — defaults to the provider's registry default.
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider_id {v!r}")
        return v

    @model_validator(mode="after")
    def _api_key_matches_provider(self) -> DerivativeRequest:
        # Managed path: no BYOK key in the body — the server resolves OUR key by
        # eligibility (ADR-005 D6). Nothing to prefix-check.
        if self.api_key is None:
            return self
        # BYOK keys are scoped to their provider — never send the wrong format.
        prefix = PROVIDER_REGISTRY[self.provider_id].key_prefix
        if prefix and not self.api_key.startswith(prefix):
            raise ValueError(f"{self.provider_id} api_key must start with {prefix}")
        return self


class PostVariant(BaseModel):
    hook: str
    body: str
    hashtags: list[str]
    cta: str | None = None


class DerivativeResponse(BaseModel):
    """Body of a completed derivative-post generation."""

    platform: str
    variants: list[PostVariant]
    provenance: str = "ai-generated"


class _DerivativeOutput(BaseModel):
    """Shape the model's JSON response is validated against."""

    variants: list[PostVariant]
