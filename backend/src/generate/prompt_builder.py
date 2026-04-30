"""Prompt construction for self-learner generation requests.

Reuses the universal formatting block (KaTeX, Mermaid, GFM tables, blockquotes,
fenced code) from the vendored `pipeline/prompts.py` so output rendering matches
the school product. The SelfLearner-specific shape adds Level / Prior knowledge /
Framing / Depth — dimensions the OnDemand prompts don't have because schools
operate against fixed curricula instead.

Output JSON schema is validated by `lesson_schema.py`. Keep the field set there
in sync with the schema example below.
"""

from __future__ import annotations

# Pull formatting + per-subject blocks from the vendored prompts module.
# These are the "scoping IP" — see SCOPE.md §3.
from pipeline.prompts import _FORMATTING_GUIDELINES, _subject_guidelines

# Map our user-facing Level → grade-equivalent integer used by
# `_subject_guidelines` and reading-level descriptors.
_LEVEL_TO_GRADE: dict[str, int] = {
    "student": 12,
    "professional": 16,
    "expert": 18,
}

_LEVEL_HUMAN: dict[str, str] = {
    "student": "a Grade 12 student",
    "professional": "a working professional",
    "expert": "an expert-level reader",
}

_DEPTH_HINTS: dict[str, str] = {
    "quick": "Keep this concise — aim for 2 short sections plus key takeaways.",
    "standard": "Aim for 3–5 sections of moderate depth.",
    "deep": "Go deep — include 5–7 sections with examples, edge cases, and connections to adjacent topics.",
}


def _infer_subject(topic: str) -> str:
    """Best-effort subject inference for picking the right per-subject guidelines.

    Used only to select formatting rules (e.g., maths topics → KaTeX-heavy
    block, CS topics → truth-table block). No user-visible effect beyond
    rendering quality.
    """
    t = topic.lower()
    if any(
        w in t
        for w in (
            "equation",
            "calculus",
            "algebra",
            "geometry",
            "trigonometry",
            "statistics",
            "matrix",
            "vector",
            "derivative",
            "integral",
        )
    ):
        return "Mathematics"
    if any(
        w in t
        for w in (
            "physics",
            "chemistry",
            "biology",
            "molecule",
            "reaction",
            "force",
            "energy",
            "cell",
            "evolution",
            "ecosystem",
        )
    ):
        return "Natural Sciences"
    if any(
        w in t
        for w in (
            "computer",
            "algorithm",
            "data structure",
            "programming",
            "code",
            "tcp",
            "binary",
            "boolean",
            "compiler",
            "operating system",
        )
    ):
        return "Computer Science"
    if any(
        w in t
        for w in (
            "balance sheet",
            "ledger",
            "accounting",
            "marketing",
            "supply",
            "demand",
            "p&l",
            "cash flow",
            "economics",
            "business",
        )
    ):
        return "Commerce"
    return "General"


def build_lesson_prompt(
    *,
    topic: str,
    level: str,
    language: str,
    depth: str = "standard",
    prior_knowledge: str | None = None,
    framing: str | None = None,
) -> str:
    """Return the prompt for generating a self-learner lesson.

    Output is JSON conforming to `lesson_schema.LessonOutput`.
    """
    # _LEVEL_TO_GRADE is reserved for future per-grade tuning; not used yet.
    audience = _LEVEL_HUMAN.get(level, "a self-learner")
    depth_hint = _DEPTH_HINTS.get(depth, _DEPTH_HINTS["standard"])
    subject = _infer_subject(topic)

    lang_instruction = (
        f"Write all content in {language.upper()}."
        if language != "en"
        else "Write all content in English."
    )

    extras_block = ""
    if prior_knowledge:
        extras_block += f"\nThe learner has told us they already know: {prior_knowledge.strip()}\n"
    if framing:
        extras_block += f"\nWhere appropriate, connect the explanation to: {framing.strip()}\n"

    return f"""You are an expert educator preparing a self-study lesson for {audience}.

{lang_instruction}

The lesson topic is: "{topic}".
{depth_hint}
{extras_block}
You MUST respond with ONLY valid JSON — no markdown fences, no extra text, no explanation outside the JSON.

{_FORMATTING_GUIDELINES}
{_subject_guidelines(subject)}
The JSON must exactly match this schema:

{{
  "topic": "{topic}",
  "level": "{level}",
  "language": "{language}",
  "synopsis": "<2-3 sentence overview of the lesson>",
  "learning_objectives": ["<objective 1>", "<objective 2>", "..."],
  "sections": [
    {{
      "heading": "<short section title>",
      "body_markdown": "<the section's prose, in Markdown — apply ALL formatting rules above>"
    }}
  ],
  "key_takeaways": ["<takeaway 1>", "<takeaway 2>", "..."],
  "further_reading": ["<optional pointer to a topic the learner could explore next>"]
}}

Requirements:
- learning_objectives: 3–5 items, starting with action verbs (e.g., "Explain...", "Calculate...", "Identify...").
- key_takeaways: 3–6 items.
- sections: as many as the depth hint suggests; each section's body_markdown must be ready to render directly.
- All maths inline as $...$ and display as $$...$$ (KaTeX). All flowcharts/sequences as ```mermaid``` code blocks.
- Do NOT include any text outside the JSON object.
"""
