"""Source-grounded per-topic generator (ADR-037 Slice C — per-topic generate).

Mirrors `generate.py`'s inline (non-async-job) validated-generation shape and
`toc_suggest.py`'s pattern: the router calls this synchronously and returns the
result in the same request. Scoped to ONE topic's sources — one section per
subtopic, grounded only in those sources.
"""

from __future__ import annotations

from pydantic import BaseModel, Field
from wegofwd_llm.conformance import generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.registry import build_provider

from backend.src.generate.anthropic_caller import parse_json_response

from .topic_prompt import build_topic_prompt

_MAX_REPAIRS = 2
_MAX_TOKENS = 4096


class _TopicSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []


class _TopicDraft(BaseModel):
    sections: list[_TopicSection] = Field(min_length=1, max_length=20)


def generate_topic_draft(
    *, sources, topic_title, subtopics, audience, goal, provider_id, api_key, model
) -> _TopicDraft:
    prompt = build_topic_prompt(sources, topic_title, subtopics, audience, goal)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(prompt=prompt, max_tokens=_MAX_TOKENS, response_format="json")

    def _validate(text: str) -> _TopicDraft:
        return _TopicDraft.model_validate(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS).parsed
