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

# Words per page used to turn a page target into a word-count instruction. A
# rendered lesson page (headings + prose + the occasional formula/diagram) runs
# lighter than a dense paragraph page, so this sits at the low end.
_WORDS_PER_PAGE = 450

# Diagram styling guidance. The compiler injects the brand palette for these role
# classes automatically (see compiler/src/tokens.ts + mermaid.ts), so the model
# only has to TAG nodes with a role — it must not emit its own classDef/colours.
# The role vocabulary here must stay in sync with DIAGRAM_ROLES in tokens.ts.
_DIAGRAM_GUIDELINES = """\
Diagram styling (Mermaid flowcharts):
- Use a `flowchart` (LR or TD) for processes, pipelines, decision flows and
  concept maps — one focused diagram beats a wall of prose.
- Colour-code each node by tagging it with EXACTLY ONE role class, appended as
  `:::role` on the node. Use only these roles:
  - `:::concept`  — a core idea / anchor / the subject itself
  - `:::process`  — a step, stage or action
  - `:::decision` — a question or branch (diamond)
  - `:::success`  — a positive outcome, result or "done" state
  - `:::warn`     — a risk, pitfall or failure path
  Example:
  ```mermaid
  flowchart LR
    A[Raw input]:::concept --> B[Transform]:::process
    B --> C{Valid?}:::decision
    C -->|yes| D[Ship]:::success
    C -->|no| B
  ```
- Do NOT write your own `classDef` lines or hex colours — they are added on
  render. Just tag nodes with `:::role`. Keep diagrams to ~4-9 nodes so they
  stay legible at page width.
"""

# Prose-quality directive — sharpen clarity WITHOUT sacrificing coverage. Avoids
# the literals asserted against in tests ("page(s)", "2 short sections").
_PROSE_QUALITY = """\
Prose quality:
- Open each section with its main point in the first sentence, then support it.
- Favour concrete examples, named scenarios and worked cases over abstraction.
- Use active voice and tight sentences; cut filler and hedging.
- Be concise but complete — keep the breadth the topic needs and the takeaways.
"""


def _length_hint(depth: str, target_pages: int) -> str:
    """The length directive for the prompt.

    A positive page target wins over the depth hint (it is the more specific
    instruction); 0 falls back to the depth-based section-count hint.
    """
    if target_pages > 0:
        lo = round(target_pages * _WORDS_PER_PAGE * 0.85)
        hi = round(target_pages * _WORDS_PER_PAGE * 1.15)
        return (
            f"Aim for approximately {target_pages} page(s) of lesson content "
            f"(roughly {lo}–{hi} words) across the sections — use as many "
            f"sections as needed to reach that length naturally. This length "
            f"target is for the lesson prose only; it excludes any quiz "
            f"questions or answers."
        )
    return _DEPTH_HINTS.get(depth, _DEPTH_HINTS["standard"])


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
    target_pages: int = 0,
    prior_knowledge: str | None = None,
    framing: str | None = None,
    instructions: str | None = None,
) -> str:
    """Return the prompt for generating a self-learner lesson.

    Output is JSON conforming to `lesson_schema.LessonOutput`.

    target_pages > 0 sets an approximate length for the lesson prose (it takes
    precedence over `depth`); 0 leaves length to the depth hint.

    instructions: free-text author guidance applied to this (re)generation —
    e.g. "add a diagram for the T-shape".
    """
    # _LEVEL_TO_GRADE is reserved for future per-grade tuning; not used yet.
    audience = _LEVEL_HUMAN.get(level, "a self-learner")
    depth_hint = _length_hint(depth, target_pages)
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
    if instructions and instructions.strip():
        extras_block += (
            "\nApply these specific improvements the author requested for this "
            f"lesson: {instructions.strip()}\n"
        )

    return f"""You are an expert educator preparing a self-study lesson for {audience}.

{lang_instruction}

The lesson topic is: "{topic}".
{depth_hint}
{extras_block}
You MUST respond with ONLY valid JSON — no markdown fences, no extra text, no explanation outside the JSON.

{_FORMATTING_GUIDELINES}
{_subject_guidelines(subject)}
{_DIAGRAM_GUIDELINES}
{_PROSE_QUALITY}
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
- All maths inline as $...$ and display as $$...$$ (KaTeX). Flowcharts/processes as ```mermaid``` flowcharts with `:::role`-tagged nodes (see Diagram styling above); other diagram kinds as ```mermaid``` code blocks.
- Do NOT include any text outside the JSON object.
"""
