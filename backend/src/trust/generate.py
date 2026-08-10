"""Inline validated generation for a source-cited trust artifact draft (ADR-037 Phase 02).

Mirrors `derivatives/generate.py`'s inline (non-async-job) generation shape: the
router calls this synchronously and returns the result in the same request.
Reuses the same provider seam + conformance loop discipline as
`generate.tasks.run_generation` — build a provider from the registry, issue a
JSON-mode request, and validate + repair via `generate_validated`.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .draft_prompt import build_draft_prompt

_MAX_REPAIRS = 2
# A whole-book draft is several sections of real prose — 4096 truncated multi-
# section drafts mid-JSON → invalid output → 502 (the same failure the per-topic
# generator hit; see reference_llm_output_shape_gotchas). Match the pipeline's
# book default.
_MAX_TOKENS = 16384


class _DraftSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []


class _DraftOutput(BaseModel):
    sections: list[_DraftSection] = Field(min_length=1, max_length=6)


def _coerce_draft(obj: object) -> _DraftOutput:
    """Validate the model's output into a _DraftOutput, tolerating a common quirk:
    some models double-encode the array, returning `sections` as a JSON STRING
    instead of a list. Decode it before validating; leave anything else to pydantic."""
    if isinstance(obj, dict) and isinstance(obj.get("sections"), str):
        try:
            obj = {**obj, "sections": json.loads(obj["sections"])}
        except (json.JSONDecodeError, TypeError):
            pass  # not a JSON array string — let pydantic raise the real error
    return _DraftOutput.model_validate(obj)


def generate_draft(
    *, sources, artifact_format, topic, audience, goal, provider_id, api_key, model, guidance=None
) -> _DraftOutput:
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _DraftOutput:
        return _coerce_draft(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
