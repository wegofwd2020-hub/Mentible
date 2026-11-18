"""Source-grounded per-topic generator (ADR-037 Slice C — per-topic generate).

Mirrors `generate.py`'s inline (non-async-job) validated-generation shape and
`toc_suggest.py`'s pattern: the router calls this synchronously and returns the
result in the same request. Scoped to ONE topic's sources — one section per
subtopic, grounded only in those sources.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, ValidationError
from wegofwd_llm.conformance import ConformanceResult, generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.core.log_redaction import get_logger
from backend.src.generate.anthropic_caller import parse_json_response
from backend.src.generate.diagram_shape import shape_topic_draft

from .generate import cap_max_tokens
from .topic_prompt import build_topic_prompt

log = get_logger(__name__)

_MAX_REPAIRS = 2
# Per-topic content is one section per subtopic — a topic with several subtopics
# of real prose easily exceeds a few thousand tokens. 4096 truncated multi-subtopic
# topics mid-JSON → invalid output → 502. Match the pipeline's book default.
_MAX_TOKENS = 16384


class _TopicSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []


class _TopicDraft(BaseModel):
    sections: list[_TopicSection] = Field(min_length=1, max_length=20)


def _coerce_topic_draft(obj: object) -> _TopicDraft:
    """Validate the model's output into a _TopicDraft, tolerating a common quirk:
    some models double-encode the array, returning `sections` as a JSON STRING
    instead of a list. Decode it before validating; leave anything else to pydantic."""
    if isinstance(obj, dict) and isinstance(obj.get("sections"), str):
        try:
            obj = {**obj, "sections": json.loads(obj["sections"])}
        except (json.JSONDecodeError, TypeError):
            pass  # not a JSON array string — let pydantic raise the real error
    return _TopicDraft.model_validate(obj)


def check_subtopic_coverage(draft: _TopicDraft, subtopics) -> _TopicDraft:
    """Guard against silent content loss on regeneration.

    A draft must have at least one section per subtopic it was asked to write.
    A shorter draft is rejected as invalid, so the repair loop asks for the
    missing sections, and if it still falls short the job fails and no new topic
    version is stored (the previous version stays).
    """
    expected = len(subtopics or [])
    if expected and len(draft.sections) < expected:
        raise ValueError(
            f"draft has {len(draft.sections)} sections for {expected} subtopics; "
            "write one section per subtopic"
        )
    return draft


def generate_topic_draft(
    *, sources, topic_title, subtopics, audience, goal, provider_id, api_key, model
) -> ConformanceResult:
    """Generate + validate a per-topic draft. Returns the full `ConformanceResult`
    (not just `.parsed`) so the caller (`trust.tasks._run`) can meter the observed
    token counts (`total_input_tokens`/`total_output_tokens`) for managed
    generations — see `_record_trust_usage`. Access the drafted `_TopicDraft` via
    `.parsed`."""
    prompt = build_topic_prompt(sources, topic_title, subtopics, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(
        prompt=prompt,
        max_tokens=cap_max_tokens(provider_id, _MAX_TOKENS, prompt=prompt),
        response_format="json",
    )

    def _validate(text: str) -> _TopicDraft:
        try:
            draft = check_subtopic_coverage(
                _coerce_topic_draft(parse_json_response(text)), subtopics
            )
            # Tree-shaped / merged flowcharts become native mindmaps (see
            # generate/diagram_shape.py). Runs inside validation, so the stored draft is the shaped one.
            draft, shaped = shape_topic_draft(draft)
            if shaped:
                log.info("diagram_shape_converted", count=shaped)
            return draft
        except Exception as exc:
            # Diagnostics only: the failure KIND and pydantic field locations, never
            # the model text or the source content (ADR-001 / privacy).
            locs = (
                [list(e.get("loc", ())) for e in exc.errors()]
                if isinstance(exc, ValidationError)
                else []
            )
            log.warning(
                "topic_draft_invalid",
                error_type=type(exc).__name__,
                field_locs=locs[:5],
                response_chars=len(text),
                finish_hint="truncated?" if not text.rstrip().endswith("}") else "complete",
            )
            raise

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
