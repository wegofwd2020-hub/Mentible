"""Prompt for a source-cited draft of a trust artifact (ADR-037 Phase 02 Create).

Mirrors derivatives/prompt.py's "use ONLY the sources" discipline, but drafts a
{format} from the expert's captured inputs and attributes each section to the
source label(s) it draws from. Invents nothing beyond the sources.
"""

from __future__ import annotations

from .diagram_guidance import DIAGRAM_GUIDANCE
from .format_specs import DEFAULT_SPEC, FORMAT_SPECS


def build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance=None) -> str:
    labelled = "\n\n".join(
        f'[S{i + 1}] ({s.kind}{": " + s.title if s.title else ""})\n"""\n{s.content}\n"""'
        for i, s in enumerate(sources)
    )
    ctx = []
    if topic:
        ctx.append(f"on {topic}")
    if audience:
        ctx.append(f"for {audience}")
    if goal:
        ctx.append(f"so the reader can {goal}")
    ctx_line = (" " + " ".join(ctx)) if ctx else ""
    guidance_line = f"\n\nAdditional guidance from the author: {guidance}" if guidance else ""
    spec = FORMAT_SPECS.get(artifact_format, DEFAULT_SPEC)
    rules_line = f" {spec.rules}" if spec.rules else ""
    # Long-form written formats (book, essay) may carry grounded diagrams; social/
    # spoken formats never do. Diagrams render in the published EPUB/PDF (the
    # compiler draws mermaid/svg) — the in-app draft editor shows the fence source.
    diagram_line = f"\n\n{DIAGRAM_GUIDANCE}" if spec.supports_diagrams else ""
    return (
        f"You are drafting a {artifact_format}{ctx_line}. Using ONLY the sources below, {spec.section_rule}."
        f"{rules_line} Attribute each section to the source label(s) it draws from. "
        f"Invent nothing beyond the sources — if the sources do not cover something, omit it.{diagram_line}{guidance_line}\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"sections": [{{"heading": "string", "body": "string", "sources": ["S1"]}}]}}\n'
        f"Return sections per the instruction above."
    )
