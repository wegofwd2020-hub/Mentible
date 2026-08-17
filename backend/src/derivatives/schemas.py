"""Request/response schemas for /derivatives endpoints (ADR-037 D8).

Validation runs at the FastAPI boundary. Internal calls trust their callers.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator
from wegofwd_llm.registry import PROVIDER_REGISTRY

# Supported destination platforms for a derivative post.
Platform = Literal["linkedin", "x"]

ImageMediaType = Literal["image/jpeg", "image/png", "image/webp"]


class ReferenceImage(BaseModel):
    """An optional reference image that STEERS post style — never copied.

    Transient: the base64 `data` is passed straight to the vision call and is
    never logged or persisted (ADR-001 / ADR-036 custody).
    """

    media_type: ImageMediaType
    # base64-encoded bytes. Capped ~5 MB raw (~6.7 MB base64) to bound the payload.
    data: str = Field(min_length=1, max_length=7_000_000)


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

    # Optional reference image (FR-1b). Steers style/tone/layout only — the
    # backend instructs the model NOT to reproduce it. Anthropic-only (the
    # router rejects image + non-anthropic with a 400).
    image: ReferenceImage | None = None

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
    """Shape the model's JSON response is validated against.

    The variant count is pinned to exactly 3 (spec open-item 1) — a model that
    returns a different count fails validation and re-enters the repair loop,
    rather than silently shipping the wrong contract.
    """

    variants: list[PostVariant] = Field(min_length=3, max_length=3)


# --- Publish image card (P1-5) ---------------------------------------------

CardSize = Literal["square", "linkedin", "story"]


class CardRequest(BaseModel):
    """Body of POST /derivatives/card — generate a promotional image card.

    Same `api_key` custody discipline as `DerivativeRequest` (ADR-001): never
    logged, never persisted in plaintext. Exactly one of `source_text` /
    `topic_version_id` must be supplied — the card is generated either from
    inline text or from an existing topic version, never both, never neither.
    """

    source_text: str | None = Field(default=None, min_length=1, max_length=20000)
    topic_version_id: uuid.UUID | None = None
    size: CardSize = "square"
    tone: str | None = None
    api_key: str | None = Field(default=None, min_length=20, max_length=512)
    provider_id: str = "anthropic"
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider_id {v!r}")
        return v

    @model_validator(mode="after")
    def _exactly_one_source(self) -> CardRequest:
        if bool(self.source_text) == bool(self.topic_version_id):
            raise ValueError("provide exactly one of source_text or topic_version_id")
        return self


class CardContent(BaseModel):
    """Shape the model's JSON response is validated against."""

    headline: str
    subtext: str
    source_label: str | None = None


class CardResponse(BaseModel):
    """Body of a completed publish-card generation."""

    card: CardContent
    size: CardSize
    image_png_base64: str
    provenance: str = "ai-generated"


# --- Publish carousel (P1-5 slice 2) ----------------------------------------


class CarouselRequest(BaseModel):
    """Body of POST /derivatives/carousel — generate a promotional image carousel.

    Same `api_key` custody discipline as `CardRequest` (ADR-001): never
    logged, never persisted in plaintext. Exactly one of `source_text` /
    `topic_version_id` must be supplied, mirroring `CardRequest`. No `size` —
    the carousel frame count (4-8) is the caller-visible dimension, not an
    aspect ratio.
    """

    source_text: str | None = Field(default=None, min_length=1, max_length=20000)
    topic_version_id: uuid.UUID | None = None
    tone: str | None = None
    api_key: str | None = Field(default=None, min_length=20, max_length=512)
    provider_id: str = "anthropic"
    model: str | None = None

    @field_validator("provider_id")
    @classmethod
    def _known_provider(cls, v: str) -> str:
        if v not in PROVIDER_REGISTRY:
            raise ValueError(f"unknown provider_id {v!r}")
        return v

    @model_validator(mode="after")
    def _exactly_one_source(self) -> CarouselRequest:
        if bool(self.source_text) == bool(self.topic_version_id):
            raise ValueError("provide exactly one of source_text or topic_version_id")
        return self


class CarouselFrame(BaseModel):
    """A single rendered carousel frame: its copy plus the rasterized image."""

    card: CardContent
    image_png_base64: str


class CarouselResponse(BaseModel):
    """Body of a completed publish-carousel generation."""

    frames: list[CarouselFrame]
    provenance: str = "ai-generated"
