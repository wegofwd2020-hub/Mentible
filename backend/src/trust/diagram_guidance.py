"""Shared grounded-diagram guidance for the trust generators.

One source of truth for the ```mermaid / ```svg instruction so the per-topic
(`topic_prompt`) and whole-book / long-form (`draft_prompt`) generators stay in
sync — in particular the MULTI-LINE mermaid rule (a one-line diagram fails to
parse and renders as raw code; see reference_llm_output_shape_gotchas).
"""

from __future__ import annotations

DIAGRAM_GUIDANCE = (
    "Where the sources support it, include a diagram that VISUALIZES what the sources "
    "describe — a ```mermaid block for a process, hierarchy, or relationship, or a ```svg "
    "block for a labeled or illustrative figure. Hold diagrams to the same bar as the prose: "
    "invent nothing beyond the sources; if a diagram would need facts the sources do not "
    "establish, omit it. Put the fenced diagram in the relevant section's body.\n"
    "MERMAID MUST BE MULTI-LINE: put the diagram-type header and EACH statement and edge on "
    "its OWN line, with a real line break between every one. NEVER put the whole diagram on a "
    "single line — mermaid cannot parse a one-line diagram and it will fail to render. Correct "
    "shape:\n"
    "```mermaid\n"
    "flowchart TD\n"
    "  A[Read paragraph] --> B[Read bullet point]\n"
    "  B --> C{More bullet points?}\n"
    "  C -- Yes --> B\n"
    "  C -- No --> D[End of section]\n"
    "```\n"
    'NEVER write "[IMAGE: ...]" or a camera emoji as a placeholder — produce an actual '
    "```mermaid/```svg diagram, or write text only."
)
