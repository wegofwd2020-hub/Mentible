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
from pipeline.providers.contract import Capabilities, LLMRequest, LLMResponse, Provider
from pipeline.providers.errors import LLMConfigurationError, LLMError, LLMResponseError


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
        except Exception:
            # Never chain: SDK exceptions may include the api_key in their repr.
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
