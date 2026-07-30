"""Inline validated generation for a source-cited trust artifact draft (ADR-037 Phase 02).

Mirrors `derivatives/generate.py`'s inline (non-async-job) generation shape: the
router calls this synchronously and returns the result in the same request.
Reuses the same provider seam + conformance loop discipline as
`generate.tasks.run_generation` — build a provider from the registry, issue a
JSON-mode request, and validate + repair via `generate_validated`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .draft_prompt import build_draft_prompt

_MAX_REPAIRS = 2
_MAX_TOKENS = 4096


class _DraftSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []


class _DraftOutput(BaseModel):
    sections: list[_DraftSection] = Field(min_length=1, max_length=6)


def generate_draft(
    *, sources, artifact_format, topic, audience, goal, provider_id, api_key, model
) -> _DraftOutput:
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _DraftOutput:
        return _DraftOutput.model_validate(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
