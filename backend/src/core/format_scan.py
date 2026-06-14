"""Gate 3 (format-drift) scanning — shared by the generation worker and the
export/compile path.

The vendored validator (`pipeline/content_format_validator.py`) exposes
`check_content(content_type, data)`. Two adaptation facts drive this module:

  - Its rich per-section checks key on a **tutorial's** ``{title, content}``
    shape. A **lesson**'s sections carry the same information under
    ``{heading, body_markdown}`` and the validator's lesson path is a deliberate
    no-op upstream — so we adapt a lesson to the tutorial shape (without editing
    the vendored file, ADR-002) and relabel the warnings back to ``"lesson"``.
  - ``tutorial`` and ``experiment`` content match the validator natively.

Native generation produces only ``lesson`` (already gate-3'd by the worker); a
migrated/authored book may also carry ``tutorial`` and ``experiment`` content
that has never passed through a generation worker — the export scan
(``book_warnings``) is the first and only place that content meets gate 3.

Surfaces:
  - ``lesson_warnings``  — one lesson (the generation worker).
  - ``book_warnings``    — a whole book.json: lesson + tutorial + experiment per
    topic (the export compiler).
  - ``package_warnings`` — an ADR-011 Consumable Package manifest's ``modules[]``,
    the ready-to-call hook for the (not-yet-built) Pramana package builder.

All functions are pure and defensive: malformed input yields ``[]`` rather than
raising — gate 3 must never fail an already-valid generation or block a compile.
"""

from __future__ import annotations

from typing import Any

from pipeline.content_format_validator import check_content


def _heading_body_warnings(sections: Any, *, label: str) -> list[dict[str, Any]]:
    """Run the validator's tutorial checks over a list of ``{heading,
    body_markdown}`` blocks and relabel the warnings' ``content_type`` to
    ``label``.

    Lessons (``LessonOutput.sections``) and ADR-011 package modules
    (``manifest.modules[]``) share this exact shape, so both reuse this adapter
    rather than touching the vendored validator (ADR-002).
    """
    try:
        adapted = {
            "sections": [
                {"title": s.get("heading", ""), "content": s.get("body_markdown", "")}
                for s in (sections or [])
                if isinstance(s, dict)
            ]
        }
        return [{**w.as_dict(), "content_type": label} for w in check_content("tutorial", adapted)]
    except Exception:
        return []


def lesson_warnings(lesson: dict[str, Any]) -> list[dict[str, Any]]:
    """Format-drift warnings for one lesson dict (``LessonOutput`` shape)."""
    if not isinstance(lesson, dict):
        return []
    return _heading_body_warnings(lesson.get("sections"), label="lesson")


def _typed_warnings(content_type: str, data: dict[str, Any]) -> list[dict[str, Any]]:
    """Native validator pass for content shapes the validator understands
    directly (``tutorial``, ``experiment``)."""
    try:
        return [w.as_dict() for w in check_content(content_type, data)]
    except Exception:
        return []


def book_warnings(book: dict[str, Any]) -> list[dict[str, Any]]:
    """Walk a book.json's generated content and collect format-drift warnings
    across every topic and content shape.

    Checks each topic's ``lesson`` (adapted), ``tutorial`` and ``experiment``
    (native); ``quizSets`` have no drift rules and are skipped. Each warning is
    tagged with ``topic_id`` / ``topic_title`` so a reviewer can locate it in the
    book. Pure + defensive — a malformed book yields ``[]``.
    """
    out: list[dict[str, Any]] = []
    content = book.get("content")
    if not isinstance(content, dict):
        return out

    for topic_id, topic in content.items():
        if not isinstance(topic, dict):
            continue
        topic_title = topic.get("title", "")

        per_topic: list[dict[str, Any]] = []
        lesson = topic.get("lesson")
        if isinstance(lesson, dict):
            per_topic += lesson_warnings(lesson)
        tutorial = topic.get("tutorial")
        if isinstance(tutorial, dict):
            per_topic += _typed_warnings("tutorial", tutorial)
        experiment = topic.get("experiment")
        if isinstance(experiment, dict):
            per_topic += _typed_warnings("experiment", experiment)

        for w in per_topic:
            out.append({**w, "topic_id": topic_id, "topic_title": topic_title})

    return out


def package_warnings(manifest: dict[str, Any]) -> list[dict[str, Any]]:
    """Gate 3 over an ADR-011 **Consumable Package** manifest, before it is
    signed + pushed to Pramana's ``consumer_library``.

    The manifest's ``modules[]`` each carry ``{order, heading, body_markdown,
    citations}`` — the same ``{heading, body_markdown}`` content shape a lesson
    section uses — so we reuse the section adapter and tag each warning with the
    module's ``order`` / ``heading``. ``quiz`` has no drift rules and is skipped.

    Ready-to-call hook: the package builder (not yet implemented — ADR-011 is
    Proposed) should call this on the assembled manifest and record the result in
    the package's provenance / review evidence. Like every gate-3 surface it is
    **non-fatal** and pure + defensive (malformed manifest yields ``[]``); a human
    reviewer still sees the warnings before approval (ADR-011 §7 / ADR-013 D4).
    See docs/QUALITY_GATES.md §1 gate 3, §5.
    """
    out: list[dict[str, Any]] = []
    modules = manifest.get("modules")
    if not isinstance(modules, list):
        return out

    for i, mod in enumerate(modules):
        if not isinstance(mod, dict):
            continue
        order = mod.get("order", i)
        heading = mod.get("heading", "")
        # Each module is a single {heading, body_markdown} block; check it on its
        # own so the warning is unambiguously attributable to this module.
        for w in _heading_body_warnings([mod], label="module"):
            out.append({**w, "module_order": order, "module_heading": heading})

    return out
