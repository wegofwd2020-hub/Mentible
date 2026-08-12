"""Source-grounded Suggest-TOC generator (ADR-037 Slice B — Structure).

Mirrors generate.py's inline (non-async-job) validated-generation shape: the
router calls this synchronously and returns the result in the same request.
Does NOT persist — the caller maps the parsed output onto real input ids and
returns a StructuredTOC-shaped payload; the client saves it via the separate
`PUT /projects/{id}/toc` endpoint (Task 1) after the user edits it.
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .toc_prompt import build_toc_prompt

_MAX_REPAIRS = 2
# 16384, not 4096: a real-sized TOC (up to 6 subjects × 8 topics × 12 subtopics
# with labels + detail) overruns 4096 output tokens, truncating the JSON. That
# fails schema validation and triggers the repair loop (_MAX_REPAIRS extra full
# LLM calls), so a single Suggest-TOC balloons to several minutes and blows past
# CloudFlare's ~100s proxy timeout — the caller sees a 524, not our 502. Match
# the per-topic (generate_topic.py) and whole-book (generate.py) generators,
# both bumped to 16384 for the same truncation reason.
_MAX_TOKENS = 16384


class _TocSubtopic(BaseModel):
    label: str
    detail: str | None = None


class _TocTopic(BaseModel):
    title: str
    subtopics: list[_TocSubtopic] = Field(default_factory=list, max_length=12)
    sources: list[str] = []


class _TocSubject(BaseModel):
    subject_label: str
    topics: list[_TocTopic] = Field(min_length=1, max_length=8)


class _TocOutput(BaseModel):
    subjects: list[_TocSubject] = Field(min_length=1, max_length=6)


def suggest_toc(*, sources, topic, audience, goal, provider_id, api_key, model) -> _TocOutput:
    prompt = build_toc_prompt(sources, topic, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _TocOutput:
        return _TocOutput.model_validate(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed


def toc_output_to_view(out: _TocOutput, sources) -> dict:
    """Map the LLM's `_TocOutput` (+ the project's inputs, for S-label→id
    resolution) into the StructuredTocView dict the client consumes. Unknown
    S-labels are dropped, never raised on."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    return {
        "subjects": [
            {
                "subject_label": subj.subject_label,
                "units": [
                    {
                        "id": str(uuid.uuid4()),
                        "title": t.title,
                        "subtopics": [
                            ({"label": st.label, "detail": st.detail} if st.detail else st.label)
                            for st in t.subtopics
                        ],
                        "prerequisites": [],
                        "source_ids": [by_label[lbl] for lbl in t.sources if lbl in by_label],
                    }
                    for t in subj.topics
                ],
            }
            for subj in out.subjects
        ]
    }
