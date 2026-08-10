"""Prompt for a source-grounded, per-topic draft (ADR-037 Slice C — per-topic generate).

Mirrors `toc_prompt.py`'s "use ONLY the sources / invent nothing" discipline and
`[S1..Sn]` labelling, but scoped to a SINGLE topic's sources (not the whole
project) and writing actual content — one section per subtopic — rather than an
outline.
"""

from __future__ import annotations

from .diagram_guidance import DIAGRAM_GUIDANCE


def build_topic_prompt(sources, topic_title, subtopics, audience, goal) -> str:
    labelled = "\n\n".join(
        f'[S{i + 1}] ({s.kind}{": " + s.title if s.title else ""})\n"""\n{s.content}\n"""'
        for i, s in enumerate(sources)
    )
    subs = (
        "; ".join(subtopics)
        if subtopics
        else "(no subtopics given — use one section for the topic)"
    )
    ctx = []
    if audience:
        ctx.append(f"for {audience}")
    if goal:
        ctx.append(f"so the reader can {goal}")
    ctx_line = (" " + " ".join(ctx)) if ctx else ""
    diagram_guidance = DIAGRAM_GUIDANCE
    return (
        f'You are writing the section on "{topic_title}"{ctx_line}. Using ONLY the sources below, '
        f"write one section per subtopic — subtopics: {subs}. Each section's heading is the subtopic; "
        f"its body is grounded ONLY in the sources and cites the source label(s) it draws from. Invent "
        f"nothing beyond the sources — if a subtopic is not covered, omit its section.\n\n"
        f"{diagram_guidance}\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"sections": [{{"heading": "string", "body": "string", "sources": ["S1"]}}]}}'
    )
