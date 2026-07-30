"""Inline validated generation for platform-scoped derivative posts (ADR-037 D8).

Unlike the async job queue used by `/generate` (generation may take minutes),
a derivative post is a small, single-call generation — the router calls this
synchronously and returns the result in the same request. Reuses the same
provider seam + conformance loop discipline as `generate.tasks.run_generation`:
build a provider from the registry, issue a JSON-mode request, and validate +
repair via `generate_validated`. On validation exhaustion, `LLMSchemaError`
propagates to the caller (the router maps it to a 502 — see Task 3).
"""

from __future__ import annotations

import anthropic
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.errors import LLMAuthError, LLMError, LLMRateLimitError, LLMSchemaError
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .prompt import build_derivative_prompt
from .schemas import DerivativeResponse, PostVariant, ReferenceImage, _DerivativeOutput

# Repair budget mirrors generate.tasks._MAX_REPAIRS (1 initial call + 2 repairs).
_MAX_REPAIRS = 2
# A handful of short social posts needs far less headroom than a full lesson.
_MAX_TOKENS = 2048


def generate_post(
    *,
    source_text: str,
    platform: str,
    tone: str | None,
    provider_id: str,
    api_key: str,
    model: str,
    image: ReferenceImage | None = None,
) -> DerivativeResponse:
    """Generate 3 platform-scoped promotional post variants for `source_text`.

    Raises `LLMSchemaError` if the model never returns schema-valid JSON within
    the repair budget; raises whatever `LLMError` subclass the provider raises
    on a transport/auth/rate-limit failure. Never logs `api_key`.
    """
    if image is not None:
        return _generate_post_with_image(
            source_text=source_text,
            platform=platform,
            tone=tone,
            api_key=api_key,
            model=model,
            image=image,
        )
    prompt = build_derivative_prompt(source_text, platform, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _DerivativeOutput:
        return _DerivativeOutput.model_validate(parse_json_response(text))

    result = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
    out: _DerivativeOutput = result.parsed
    variants: list[PostVariant] = out.variants
    return DerivativeResponse(platform=platform, variants=variants, provenance="ai-generated")


def _generate_post_with_image(
    *,
    source_text: str,
    platform: str,
    tone: str | None,
    api_key: str,
    model: str,
    image: ReferenceImage,
) -> DerivativeResponse:
    """Vision variant of generate_post — Anthropic-only, single call.

    Bypasses the text seam (LLMRequest is text-only) but re-raises the seam's
    LLMError subclasses so the router's cascade is unchanged. api_key and
    image.data are transient — never logged or returned.
    """
    prompt = build_derivative_prompt(source_text, platform, tone, has_reference=True)
    content = [
        {"type": "text", "text": prompt},
        {
            "type": "image",
            "source": {"type": "base64", "media_type": image.media_type, "data": image.data},
        },
    ]
    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = client.messages.create(
            model=model,
            max_tokens=_MAX_TOKENS,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.AuthenticationError:
        # `from None` deliberately drops the SDK exception as __cause__: it
        # carries the httpx.Request (incl. the Authorization/x-api-key header)
        # and chaining it would let the key leak into a traceback (CLAUDE.md
        # backend rule #1). Mirrors wegofwd_llm.anthropic_native._map_sdk_error.
        raise LLMAuthError("anthropic rejected the credentials") from None
    except anthropic.PermissionDeniedError:
        raise LLMAuthError("anthropic denied the credentials") from None
    except anthropic.RateLimitError:
        raise LLMRateLimitError("anthropic rate-limited") from None
    except Exception:  # transport / unexpected — key-free
        raise LLMError("anthropic vision call failed") from None

    text = "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")
    try:
        out = _DerivativeOutput.model_validate(parse_json_response(text))
    except Exception:
        raise LLMSchemaError("generated content failed validation") from None
    variants: list[PostVariant] = out.variants
    return DerivativeResponse(platform=platform, variants=variants, provenance="ai-generated")
