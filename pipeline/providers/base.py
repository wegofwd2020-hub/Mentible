"""
pipeline/providers/base.py

Abstract base class for all LLM provider clients.

Every provider must implement generate() which calls the underlying LLM
and returns (response_text, input_tokens, output_tokens).

The pipeline passes prompts that instruct the model to return only valid JSON.
Providers are responsible only for making the call — JSON parsing and schema
validation are handled by build_unit._generate_and_validate().
"""

from __future__ import annotations

from abc import ABC, abstractmethod


class LLMProvider(ABC):
    """Abstract LLM provider. One instance per pipeline run."""

    # Subclasses set this to a stable string identifier.
    provider_id: str = ""

    @abstractmethod
    def generate(self, prompt: str, max_tokens: int = 16384) -> tuple[str, int, int]:
        """
        Send prompt to the LLM and return the raw text response.

        Args:
            prompt: Full prompt string (instruction + JSON schema).
            max_tokens: Output token ceiling for this call. Defaults to the
                conservative 16384; callers raise it when a longer response is
                expected (e.g. a multi-page lesson target).

        Returns:
            (response_text, input_tokens, output_tokens)
            input_tokens and output_tokens are best-effort — return 0 if the
            provider SDK does not expose usage counts.

        Raises:
            RuntimeError: On API errors, rate limits, or empty responses.
        """
