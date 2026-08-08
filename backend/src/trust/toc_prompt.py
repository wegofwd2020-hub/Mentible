"""Prompt for a source-grounded outline (TOC) of a trust project (Slice B).

Mirrors draft_prompt.py's "use ONLY the sources / invent nothing" discipline, but
proposes an OUTLINE (subjects -> topics) of what the sources cover, attributing
each topic to its source label(s). No content is written here — just structure.
"""

from __future__ import annotations


def build_toc_prompt(sources, topic, audience, goal) -> str:
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
    return (
        f"You are outlining a long-form work{ctx_line}. Using ONLY the sources below, propose an "
        f"outline of what the sources actually cover: 1 to 6 subjects, each with 1 to 8 topics. "
        f"For each topic, break it into the concrete subtopics the sources actually discuss — be "
        f"thorough; do not collapse a topic to a bare title. Give a subtopic a short one-line "
        f"'detail' when the sources support a concrete gloss; otherwise leave detail empty (label "
        f"only). Attribute each topic to the source label(s) it draws from. Invent nothing beyond "
        f"the sources — if the sources do not cover something, omit it.\n\n"
        f"SOURCES:\n{labelled}\n\n"
        f"Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        f'{{"subjects": [{{"subject_label": "string", "topics": [{{"title": "string", '
        f'"subtopics": [{{"label": "string", "detail": "string or null"}}], "sources": ["S1"]}}]}}]}}'
    )
