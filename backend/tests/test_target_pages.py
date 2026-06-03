"""Tests for the target-pages length control.

Covers the two pure pieces that turn a per-lesson page target into prompt text
and an output-token ceiling: prompt_builder.build_lesson_prompt and
tasks._max_tokens_for_pages.
"""

from __future__ import annotations

from backend.src.generate.prompt_builder import build_lesson_prompt
from backend.src.generate.tasks import (
    _DEFAULT_MAX_TOKENS,
    _MODEL_MAX_TOKENS,
    _max_tokens_for_pages,
)


def _prompt(**kw) -> str:
    base = {"topic": "Kinematics", "level": "student", "language": "en"}
    base.update(kw)
    return build_lesson_prompt(**base)


class TestPromptLengthHint:
    def test_page_target_adds_a_page_length_instruction(self):
        p = _prompt(target_pages=3)
        assert "3 page(s)" in p
        # excludes quizzes/answers from the length target
        assert "excludes any quiz" in p

    def test_zero_pages_falls_back_to_depth_hint(self):
        p = _prompt(target_pages=0, depth="deep")
        assert "page(s)" not in p
        assert "Go deep" in p

    def test_page_target_overrides_depth(self):
        p = _prompt(target_pages=2, depth="quick")
        assert "2 page(s)" in p
        # the quick-depth section-count hint should not also appear
        assert "2 short sections" not in p


class TestEnhancementInstructions:
    def test_instructions_added_when_set(self):
        p = _prompt(instructions="Add a diagram for the T-shape")
        assert "Add a diagram for the T-shape" in p
        assert "improvements the author requested" in p

    def test_no_instructions_block_when_absent(self):
        assert "improvements the author requested" not in _prompt()

    def test_blank_instructions_ignored(self):
        assert "improvements the author requested" not in _prompt(instructions="   ")


class TestMaxTokensForPages:
    def test_zero_uses_the_default_ceiling(self):
        assert _max_tokens_for_pages(0) == _DEFAULT_MAX_TOKENS

    def test_small_target_never_drops_below_default(self):
        # 1 page * 800 < default, so it must clamp up to the default.
        assert _max_tokens_for_pages(1) == _DEFAULT_MAX_TOKENS

    def test_large_target_scales_up(self):
        assert _max_tokens_for_pages(40) == 40 * 800

    def test_caps_at_model_maximum(self):
        assert _max_tokens_for_pages(100) == _MODEL_MAX_TOKENS
