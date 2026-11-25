"""A `%% block-diagram` marker keeps a branching flowchart as a flowchart.

Without the marker a pure-tree flowchart is rewritten as a mindmap (see
test_diagram_shape.py); with it the shaper must leave the diagram untouched.
"""

from __future__ import annotations

from backend.src.generate.diagram_shape import mindmap_for, rewrite_markdown
from backend.src.trust.diagram_guidance import DIAGRAM_GUIDANCE

BLOCK = """flowchart LR
  %% block-diagram
  A["Keyboard"] --> B["USB or MIDI interface"]
  B --> C["Computer"]
  B --> D["Power supply"]
  C --> E["Speakers"]
"""


def test_marked_block_diagram_is_not_converted():
    assert mindmap_for(BLOCK) is None


def test_marker_is_case_insensitive():
    assert mindmap_for(BLOCK.replace("block-diagram", "Block-Diagram")) is None


def test_unmarked_branching_flowchart_still_converts():
    unmarked = BLOCK.replace("  %% block-diagram\n", "")
    assert mindmap_for(unmarked) is not None


def test_marked_diagram_left_unchanged_in_markdown():
    body = f"Intro\n\n```mermaid\n{BLOCK}```\n"
    text, count = rewrite_markdown(body)
    assert count == 0
    assert text == body


def test_trust_guidance_teaches_the_marker():
    assert "%% block-diagram" in DIAGRAM_GUIDANCE
