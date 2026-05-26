"""Prompt construction for /structure (free-text TOC → structured tree).

Mirrors generate/prompt_builder.py: the prompt IP (the template) is vendored in
`pipeline/toc_structurer.py`; assembly happens here on the backend side.
"""

from __future__ import annotations

from pipeline.toc_structurer import STRUCTURE_PROMPT_TEMPLATE


def build_structure_prompt(raw_toc: str, grade: int | None = None) -> str:
    """Format the vendored structuring template for one TOC."""
    grade_clause = f" for grade {grade}" if grade else ""
    return STRUCTURE_PROMPT_TEMPLATE.format(grade_clause=grade_clause, raw_toc=raw_toc)
