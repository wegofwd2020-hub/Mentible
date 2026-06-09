"""Test helpers for the multi-provider generation path.

Since Phase 4 the lesson worker builds providers via `tasks.build_provider`
(anthropic → tool-use native provider, others → OpenAI-compatible). Tests patch
that single factory with a fake `Provider` instead of mocking a specific SDK —
provider-agnostic and robust to which concrete provider the registry returns.
"""

from __future__ import annotations

from unittest.mock import MagicMock

from pipeline.providers.contract import LLMResponse


def llm_response(
    text: str,
    *,
    in_tok: int = 100,
    out_tok: int = 500,
    model: str = "claude-sonnet-4-6",
    provider: str = "anthropic",
) -> LLMResponse:
    return LLMResponse(
        text=text,
        provider_id=provider,
        model=model,
        input_tokens=in_tok,
        output_tokens=out_tok,
    )


def fake_provider(
    *,
    text: str | None = None,
    responses: list[str] | None = None,
    side_effect=None,
    model: str = "claude-sonnet-4-6",
    provider: str = "anthropic",
):
    """A MagicMock standing in for a `Provider`, for patching tasks.build_provider.

    - text:       one response text, returned on every generate() call
    - responses:  a sequence of response texts → one LLMResponse per call
                  (e.g. ["bad", good] to exercise the repair loop)
    - side_effect: passed straight to generate.side_effect (e.g. an exception)
    `.model` is set so registry.provenance(provider_id, provider.model) works.
    """
    p = MagicMock()
    p.model = model
    if side_effect is not None:
        p.generate.side_effect = side_effect
    elif responses is not None:
        p.generate.side_effect = [
            llm_response(t, model=model, provider=provider) for t in responses
        ]
    else:
        p.generate.return_value = llm_response(text or "", model=model, provider=provider)
    return p
