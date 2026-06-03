"""Thin wrapper around the vendored AnthropicProvider.

This is the seam tests mock — by patching `call_anthropic` directly, tests
avoid touching the real Anthropic SDK or constructing real provider instances.

CRITICAL: this module never logs the api_key. Even on exception, the user's
key must not appear in the traceback or error message. We catch broad
exceptions, log a SAFE message (no traceback dump), and re-raise our own
exception type that carries no key material.
"""

from __future__ import annotations

import json

from pipeline.providers.anthropic import AnthropicProvider

from backend.src.core.log_redaction import get_logger

log = get_logger("anthropic_caller")


class AnthropicCallError(Exception):
    """Raised when the Anthropic call fails for any reason.

    The user-facing error message is intentionally generic — never include
    SDK exception chains because they may stringify the api_key.
    """


def call_anthropic(*, api_key: str, prompt: str, model: str, max_tokens: int = 16384) -> str:
    """Invoke Anthropic with the user's BYOK key, return raw response text.

    This function is synchronous because the Anthropic SDK is synchronous;
    callers should run it in a thread executor (`asyncio.to_thread`).

    Args:
        api_key: User's Anthropic API key (sk-ant-*).
        prompt:  Full prompt string from prompt_builder.
        model:   Anthropic model identifier (e.g., claude-sonnet-4-6).
        max_tokens: Output token ceiling — raised for multi-page lesson targets.

    Returns:
        Raw response text from Claude (expected to be JSON, parsed by caller).

    Raises:
        AnthropicCallError: on any failure. The exception message is safe to log.
    """
    if not api_key:
        raise AnthropicCallError("missing api_key")

    try:
        provider = AnthropicProvider(api_key=api_key, model=model)
        text, in_tok, out_tok = provider.generate(prompt, max_tokens=max_tokens)
    except Exception as exc:
        # Log the EXCEPTION TYPE only — never the message, never with exc_info.
        # SDK exceptions sometimes include the api_key in their repr.
        log.warning("anthropic_call_failed", exception_class=type(exc).__name__)
        raise AnthropicCallError("Anthropic call failed") from None

    log.info(
        "anthropic_call_ok",
        model=model,
        input_tokens=in_tok,
        output_tokens=out_tok,
        response_chars=len(text),
    )
    return text


def parse_json_response(text: str) -> dict:
    """Parse the raw text into a JSON dict. Strips an optional code-fence prefix
    if Claude returns one despite the prompt saying not to.

    Raises:
        AnthropicCallError: on JSON parse failure. Error message is safe.
    """
    cleaned = text.strip()
    if cleaned.startswith("```"):
        # Strip a ```json or ``` fence + trailing ```
        first_nl = cleaned.find("\n")
        if first_nl != -1:
            cleaned = cleaned[first_nl + 1 :]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].rstrip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError as exc:
        # Don't include the response text in the log either — it might echo
        # something we shouldn't surface. Just record the failure shape.
        log.warning(
            "anthropic_json_parse_failed",
            error_pos=exc.pos,
            response_chars=len(text),
        )
        raise AnthropicCallError("Anthropic returned invalid JSON") from None
