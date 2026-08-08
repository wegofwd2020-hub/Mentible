"""Source-grounded Suggest-TOC generator (ADR-037 Slice B — Structure).

Mirrors generate.py's inline (non-async-job) validated-generation shape: the
router calls this synchronously and returns the result in the same request.
Does NOT persist — the caller maps the parsed output onto real input ids and
returns a StructuredTOC-shaped payload; the client saves it via the separate
`PUT /projects/{id}/toc` endpoint (Task 1) after the user edits it.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .toc_prompt import build_toc_prompt

_MAX_REPAIRS = 2
_MAX_TOKENS = 4096


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
