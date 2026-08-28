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
from wegofwd_llm.conformance import ConformanceResult, generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.config import settings
from backend.src.generate.anthropic_caller import parse_json_response

from .draft_prompt import build_draft_prompt


def cap_max_tokens(provider_id: str, max_tokens: int) -> int:
    """Groq's free tier caps tokens-per-minute (input+output); keep OUTPUT under it
    so input+output fits — otherwise an 8000-output request + the prompt is rejected
    413. Mirrors generate.tasks.run_generation's cap. No-op for other providers;
    env-tunable via GROQ_MAX_OUTPUT_TOKENS (0 disables). Shared by every trust
    generation path (draft / topic / grounding / originality)."""
    if provider_id == "groq" and settings.groq_max_output_tokens > 0:
        return min(max_tokens, settings.groq_max_output_tokens)
    return max_tokens


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
) -> ConformanceResult:
    """Generate + validate a whole-book/artifact draft. Returns the full
    `ConformanceResult` (not just `.parsed`) so the caller
    (`trust.tasks._run_version`) can meter the observed token counts
    (`total_input_tokens`/`total_output_tokens`) for managed generations — see
    `_record_trust_usage`. Access the drafted `_DraftOutput` via `.parsed`."""
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(
        prompt=prompt, max_tokens=cap_max_tokens(provider_id, _MAX_TOKENS), response_format="json"
    )

    def _validate(text: str) -> _DraftOutput:
        return _coerce_draft(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)


def draft_output_to_sections(out: _DraftOutput, sources) -> tuple[list[dict], list[str]]:
    """Map a `_DraftOutput`'s model-labelled sources (S1..Sn) to real input ids.

    Shared by the sync path and `trust.tasks._run_version` — drop unknown
    labels rather than 500 on a bad one (the model occasionally invents a
    label that doesn't exist)."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    sections = [
        {
            "heading": sec.heading,
            "body": sec.body,
            "source_ids": [by_label[label] for label in sec.sources if label in by_label],
        }
        for sec in out.sections
    ]
    cited = sorted({sid for s in sections for sid in s["source_ids"]})
    return sections, cited
