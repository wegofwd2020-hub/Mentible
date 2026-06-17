"""
pipeline/providers/anthropic_adapter.py

Wraps the existing (legacy, tuple-returning) AnthropicProvider in the new
`Provider` contract WITHOUT modifying anthropic.py — so the multi-provider core
can drive Anthropic today and the backend rewire can switch over later.

`req.max_tokens` IS honoured (passed through to the legacy generate, which
already accepts it) so the page-scaled token ceiling is preserved when the
backend routes through this adapter. Errors are remapped to the typed hierarchy
with KEY-FREE messages (the SDK's exceptions can stringify the api_key, so they
are never chained).
"""

from __future__ import annotations

from pipeline.providers.anthropic import AnthropicProvider
from wegofwd_llm.contract import Capabilities, LLMRequest, LLMResponse, Provider
from wegofwd_llm.errors import (
    LLMAuthError,
    LLMConfigurationError,
    LLMError,
    LLMRateLimitError,
    LLMResponseError,
)


class AnthropicAdapter(Provider):
    provider_id = "anthropic"
    # Anthropic's reliable JSON path is tool-use, not response_format.
    capabilities = Capabilities(
        json_object=False, json_schema=False, tools=True, max_context=200_000
    )

    def __init__(self, *, api_key: str, model: str = "claude-sonnet-4-6") -> None:
        try:
            self._inner = AnthropicProvider(api_key=api_key, model=model)
        except RuntimeError as exc:
            # AnthropicProvider's messages are key-free ("requires a non-empty
            # api_key (BYOK)" / "anthropic SDK not installed"), so this is safe.
            raise LLMConfigurationError(str(exc)) from None
        self._model = model

    @property
    def model(self) -> str:
        return self._model

    def generate(self, req: LLMRequest) -> LLMResponse:
        try:
            text, in_tok, out_tok = self._inner.generate(
                req.prompt, max_tokens=req.max_tokens
            )
        except Exception as exc:
            # Map the SDK's HTTP status to a typed, key-free error so callers can
            # tell "your key was rejected" (401/403) and "rate limited" (429) apart
            # from a generic failure. We read ONLY the integer status_code — never
            # stringify or chain the SDK exception, whose repr can carry the api_key.
            status = getattr(exc, "status_code", None)
            if status in (401, 403):
                raise LLMAuthError("anthropic authentication failed") from None
            if status == 429:
                raise LLMRateLimitError("anthropic rate limit") from None
            raise LLMError("anthropic call failed") from None
        if not text:
            raise LLMResponseError("anthropic returned an empty response")
        return LLMResponse(
            text=text,
            provider_id="anthropic",
            model=self._model,
            input_tokens=in_tok,
            output_tokens=out_tok,
            tokens_estimated=False,
            raw=None,
        )
