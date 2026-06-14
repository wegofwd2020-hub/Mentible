"""Gate 3 — format-drift warnings over a validated lesson.

`_format_warnings` runs the vendored content_format_validator over a
schema-valid LessonOutput and returns non-fatal warnings (review-queue signal).
It must:
  - flag a tabular-by-title section that carries no GFM table,
  - flag a formula-by-title section that carries no KaTeX delimiter,
  - relabel warnings to content_type "lesson" (the validator's rich checks are
    keyed on the tutorial shape; we adapt heading/body_markdown -> title/content),
  - stay silent on clean content,
  - never raise (defensive — gate 3 must not break a good generation).
"""

from __future__ import annotations

from backend.src.generate.lesson_schema import LessonOutput, LessonSection
from backend.src.generate.tasks import _format_warnings


def _lesson(sections: list[LessonSection]) -> LessonOutput:
    return LessonOutput(
        topic="Accounting",
        level="intro",
        language="en",
        synopsis="A short synopsis.",
        learning_objectives=["Understand the basics"],
        sections=sections,
        key_takeaways=["One takeaway"],
    )


def test_flags_missing_table_and_formula():
    lesson = _lesson(
        [
            LessonSection(
                heading="The Balance Sheet",
                body_markdown="Assets are things you own. No table appears here.",
            ),
            LessonSection(
                heading="Quadratic Formula",
                body_markdown="Just prose describing roots, with no math delimiters.",
            ),
            LessonSection(
                heading="Introduction",
                body_markdown="A plain prose section with no structural expectations.",
            ),
        ]
    )

    warnings = _format_warnings(lesson)

    rules = {(w["rule"], w["location"]) for w in warnings}
    assert ("expected_table", "sections[0].content") in rules
    assert ("expected_formula", "sections[1].content") in rules
    assert len(warnings) == 2  # the plain section produces nothing
    # All warnings relabelled to the lesson content type, not "tutorial".
    assert all(w["content_type"] == "lesson" for w in warnings)


def test_clean_lesson_has_no_warnings():
    lesson = _lesson(
        [
            LessonSection(
                heading="The Balance Sheet",
                body_markdown="| Account | Amount |\n|---|---|\n| Cash | 100 |",
            ),
            LessonSection(
                heading="Quadratic Formula",
                body_markdown="The roots are $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.",
            ),
        ]
    )

    assert _format_warnings(lesson) == []


def test_never_raises_on_unexpected_shape():
    # A pathological lesson should degrade to [] rather than propagate, since a
    # gate-3 failure must never fail an already-valid generation.
    class Broken:
        sections = "not a list of sections"

    assert _format_warnings(Broken()) == []  # type: ignore[arg-type]
