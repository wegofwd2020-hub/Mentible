"""Coverage guard: a regenerated topic draft must keep one section per subtopic.

Without it, a model can silently drop subtopics it judges uncovered and the
regenerated topic loses content versus the previous version.
"""

from __future__ import annotations

import pytest

from backend.src.trust.generate_topic import _TopicDraft, check_subtopic_coverage
from backend.src.trust.topic_prompt import build_topic_prompt


def _draft(n: int) -> _TopicDraft:
    return _TopicDraft.model_validate(
        {"sections": [{"heading": f"H{i}", "body": "text", "sources": []} for i in range(n)]}
    )


def test_short_draft_is_rejected():
    with pytest.raises(ValueError, match="1 sections for 4 subtopics"):
        check_subtopic_coverage(_draft(1), ["a", "b", "c", "d"])


def test_full_draft_is_accepted_unchanged():
    draft = _draft(4)
    assert check_subtopic_coverage(draft, ["a", "b", "c", "d"]) is draft


def test_extra_sections_are_accepted():
    draft = _draft(5)
    assert check_subtopic_coverage(draft, ["a", "b"]) is draft


def test_no_subtopics_means_no_requirement():
    draft = _draft(1)
    assert check_subtopic_coverage(draft, []) is draft
    assert check_subtopic_coverage(draft, None) is draft


def test_prompt_requires_a_section_per_subtopic():
    prompt = build_topic_prompt([], "T", ["a", "b"], None, None)
    assert "Include a section for EVERY subtopic" in prompt
    assert "omit its section" not in prompt
