"""Music subject block: routing by topic keyword and the SVG override."""

from backend.src.generate.prompt_builder import (
    _MUSIC_NO_SVG_GUIDELINES,
    _MUSIC_SVG_GUIDELINES,
    build_lesson_prompt,
)


def _lesson(topic: str, include_svg: bool = True) -> str:
    return build_lesson_prompt(
        topic=topic,
        level="student",
        language="en",
        include_svg=include_svg,
    )


def test_keyboard_topic_gets_music_svg_block():
    p = _lesson("Day 1: Keyboard Basics")
    assert _MUSIC_SVG_GUIDELINES in p
    assert "labelled" in p.lower() or "<text> label" in p


def test_music_block_is_dropped_when_svg_disabled():
    p = _lesson("Day 1: Keyboard Basics", include_svg=False)
    assert _MUSIC_NO_SVG_GUIDELINES in p
    assert _MUSIC_SVG_GUIDELINES not in p


def test_non_music_topic_gets_no_music_block():
    p = _lesson("Photosynthesis in leaves")
    assert "SUBJECT-SPECIFIC — MUSIC" not in p
