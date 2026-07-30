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

from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .prompt import build_derivative_prompt
from .schemas import DerivativeResponse, PostVariant, _DerivativeOutput

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
) -> DerivativeResponse:
    """Generate 3 platform-scoped promotional post variants for `source_text`.

    Raises `LLMSchemaError` if the model never returns schema-valid JSON within
    the repair budget; raises whatever `LLMError` subclass the provider raises
    on a transport/auth/rate-limit failure. Never logs `api_key`.
    """
    prompt = build_derivative_prompt(source_text, platform, tone)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _DerivativeOutput:
        return _DerivativeOutput.model_validate(parse_json_response(text))

    result = generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
    out: _DerivativeOutput = result.parsed
    variants: list[PostVariant] = out.variants
    return DerivativeResponse(platform=platform, variants=variants, provenance="ai-generated")
