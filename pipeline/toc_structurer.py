"""
pipeline/toc_structurer.py — free-text TOC → structured curriculum tree.

VENDORED from StudyBuddy_OnDemand (see VENDORED.md). The book-authoring flow
lets a self-learner paste a rough, free-text table of contents (a textbook
index, a syllabus outline, a bullet list) and turns it into the canonical
structured shape:

    {
      "subjects": [
        {"subject_label": "Physics",
         "units": [
           {"title": "Kinematics",
            "subtopics": ["Speed", "Velocity", "Acceleration"],
            "prerequisites": []},
           ...
         ]}
      ]
    }

The LLM's job is *extraction + light normalisation* — group loose lines into
subjects → units → subtopics and surface obvious prerequisite hints. It must
not invent units the user didn't write; the user edits the result in the
topic-tree editor afterwards.

DIVERGED FROM OnDemand: the OnDemand original exposes a `structure_toc(raw_toc,
grade, provider)` helper that calls `provider.generate(prompt)` itself and, on
failure, interpolates the provider exception into a `StructureError` message —
which on a BYOK stack risks stringifying the user's api_key into a log line
(CLAUDE.md pitfall #1). Q therefore does NOT vendor that network wrapper. Q
drives the LLM call through the backend's key-safe `call_anthropic` seam (see
ADR-001) and uses only the pure pieces here: the Pydantic models, the prompt
template, and `parse_structured_toc()`. Keep this divergence on the next sync.

Public surface:
  - TopicNode / SubjectNode / StructuredTOC   Pydantic models
  - StructureError                            raised on unrecoverable parse failure
  - STRUCTURE_PROMPT_TEMPLATE                  the prompt IP (formatted by the backend)
  - parse_structured_toc()                     pure text → StructuredTOC (no network)
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field, ValidationError


class TopicNode(BaseModel):
    """One unit/topic within a subject."""

    title: str = Field(min_length=1, max_length=300)
    subtopics: list[str] = Field(default_factory=list)
    prerequisites: list[str] = Field(default_factory=list)


class SubjectNode(BaseModel):
    """A subject grouping a list of units."""

    subject_label: str = Field(min_length=1, max_length=200)
    units: list[TopicNode] = Field(default_factory=list)


class StructuredTOC(BaseModel):
    """The full structured table of contents."""

    subjects: list[SubjectNode] = Field(default_factory=list)


class StructureError(RuntimeError):
    """Raised when the LLM output cannot be parsed into a StructuredTOC.

    The message is always safe to surface/log — it never echoes the raw LLM
    response (which could contain unexpected content) nor any key material.
    """


STRUCTURE_PROMPT_TEMPLATE = """\
You are a curriculum architect. A self-learner has pasted a rough, free-text
table of contents for educational material{grade_clause}. Turn it into a
clean structured tree.

Raw table of contents:
\"\"\"
{raw_toc}
\"\"\"

Rules:
- Group lines into subjects → units → subtopics, following the author's
  evident intent. A "subject" is a broad area (e.g. Physics); a "unit" is a
  chapter/topic (e.g. Kinematics); "subtopics" are the finer points listed
  under it.
- If the paste covers a single subject with no explicit subject heading,
  infer ONE reasonable subject_label and put every unit under it.
- Populate "prerequisites" ONLY when the source text makes a dependency
  explicit, or when a unit unmistakably requires an earlier unit's concept.
  Reference prerequisites by the exact unit "title" you assigned. When in
  doubt, leave prerequisites empty — do not guess.
- Do NOT invent units, subtopics, or subjects that are not implied by the
  source. Do NOT drop content the author wrote.

Return ONLY a JSON object (no prose, no markdown fences) of this exact shape:
{{
  "subjects": [
    {{
      "subject_label": "string",
      "units": [
        {{"title": "string", "subtopics": ["string", ...], "prerequisites": ["string", ...]}}
      ]
    }}
  ]
}}
"""


def _strip_code_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        first_nl = t.find("\n")
        if first_nl != -1:
            t = t[first_nl + 1 :]
        if t.rstrip().endswith("```"):
            t = t.rstrip()[:-3]
    return t.strip()


def parse_structured_toc(text: str) -> StructuredTOC:
    """Parse a raw LLM response into a non-empty StructuredTOC.

    Pure function — no network, no provider. The backend calls the LLM through
    its key-safe seam and hands the raw text here.

    Raises:
        StructureError: the text is not parseable, non-empty JSON matching the
            StructuredTOC schema. The message is safe to log (no response body,
            no key material).
    """
    cleaned = _strip_code_fences(text)
    if not cleaned:
        raise StructureError("empty LLM response")

    try:
        parsed = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        # Record only the failure position, never the response text.
        raise StructureError(f"bad JSON from LLM (pos {exc.pos})") from None

    try:
        structured = StructuredTOC(**parsed)
    except (ValidationError, TypeError):
        raise StructureError("structured TOC failed schema validation") from None

    if not structured.subjects or not any(s.units for s in structured.subjects):
        raise StructureError("structured TOC has no subjects/units")

    return structured
