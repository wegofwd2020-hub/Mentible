"""Prompt for a source-cited draft of a trust artifact (ADR-037 Phase 02 Create).

Mirrors derivatives/prompt.py's "use ONLY the sources" discipline, but drafts a
{format} from the expert's captured inputs and attributes each section to the
source label(s) it draws from. Invents nothing beyond the sources.
"""

from __future__ import annotations


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
    return (
        f"You are drafting a {artifact_format}{ctx_line}. Using ONLY the sources below, write a short "
        f"draft of 3 to 6 sections. Attribute each section to the source label(s) it draws from. "
        f"Invent nothing beyond the sources — if the sources do not cover something, omit it.{guidance_line}\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"sections": [{{"heading": "string", "body": "string", "sources": ["S1"]}}]}}\n'
        f"Return 3 to 6 sections."
    )
