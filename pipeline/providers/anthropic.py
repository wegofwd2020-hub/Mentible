"""
pipeline/providers/anthropic.py

Anthropic Claude provider for StudyBuddy Q.

DIVERGED FROM OnDemand: the constructor accepts the API key as a positional
argument (not from config/env) so each request can use the user's BYOK key.
See ADR-001 (BYOK security model) and ADR-002 (vendoring strategy) for why.

When syncing this file from OnDemand, the divergence is intentional — the
sync script must flag it and require manual three-way merge.
"""

from __future__ import annotations

from pipeline.providers.base import LLMProvider


class AnthropicProvider(LLMProvider):
    """Calls Anthropic Claude with a per-instance BYOK key.

    A new instance is created per /generate request, used once, then discarded.
    The api_key is not stored on the instance beyond construction; the SDK
    client holds it internally.
    """

    provider_id = "anthropic"

    def __init__(self, api_key: str, model: str = "claude-sonnet-4-6") -> None:
        if not api_key:
            raise RuntimeError("AnthropicProvider requires a non-empty api_key (BYOK)")

        try:
            import anthropic
        except ImportError as exc:
            raise RuntimeError(
                "anthropic SDK not installed. Run: pip install anthropic"
            ) from exc

        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model

    def generate(self, prompt: str, max_tokens: int = 16384) -> tuple[str, int, int]:
        message = self._client.messages.create(
            model=self._model,
            # Default 16384 matches OnDemand: Epic 11 prompts (GFM tables +
            # KaTeX) regularly exceed 8192 output tokens, causing mid-string
            # JSON truncation on the client side. Sonnet 4.6 supports up to 64K,
            # so the caller raises this ceiling for multi-page lesson targets.
            max_tokens=max_tokens,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text if message.content else ""
        if not text:
            raise RuntimeError("Anthropic returned an empty response")
        input_tokens = message.usage.input_tokens if message.usage else 0
        output_tokens = message.usage.output_tokens if message.usage else 0
        return text, input_tokens, output_tokens

    @property
    def model(self) -> str:
        return self._model
