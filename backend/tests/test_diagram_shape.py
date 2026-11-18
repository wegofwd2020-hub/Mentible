"""Post-generation diagram shape check: pure-tree flowcharts become mindmaps;
ordered, merged, decision or unparseable diagrams are left unchanged.
"""

from __future__ import annotations

from backend.src.generate.diagram_shape import (
    mindmap_for,
    rewrite_markdown,
    shape_lesson,
    shape_topic_draft,
)
from backend.src.generate.lesson_schema import LessonOutput

HUB = """flowchart TD
  A["Five-Layer Framework"] --> B["Data Foundation"]
  A --> C["LLM Platform"]
  A --> D["Operations and Integration"]
  A --> E["Interface and Consumption"]
  A --> F["System-Wide Guardrails"]
"""

CHAIN = """flowchart LR
  A["Ingest"] --> B["Chunk"] --> C["Embed"] --> D["Store"]
"""

MERGE = """flowchart TD
  A["Raw"] --> B["Clean"]
  A --> C["Index"]
  B --> D["RAG"]
  C --> D
  D --> E["LLM"]
"""

DECISION = """flowchart TD
  A["Input"] --> B{"Action required?"}
  B -->|yes| C["Dispatch"]
  B -->|no| D["Memory"]
  C --> E["Result"]
"""

SUBGRAPH = """flowchart TD
  subgraph G [Group]
    A["One"] --> B["Two"]
  end
  A --> C["Three"]
  A --> D["Four"]
"""


def test_hub_with_partners_becomes_mindmap():
    out = mindmap_for(HUB)
    assert out is not None
    lines = out.splitlines()
    assert lines[0] == "mindmap"
    assert lines[1] == "  root((Five-Layer Framework))"
    assert '    B["Data Foundation"]' in lines
    assert '    F["System-Wide Guardrails"]' in lines
    assert "-->" not in out


def test_nested_tree_keeps_indentation():
    src = """flowchart TD
  A["Root"] --> B["Mid"]
  A --> C["Other"]
  B --> D["Leaf one"]
  B --> E["Leaf two"]
"""
    out = mindmap_for(src)
    assert out is not None
    assert '      D["Leaf one"]' in out.splitlines()


def test_chain_is_an_ordered_process_and_is_kept():
    assert mindmap_for(CHAIN) is None


def test_merge_is_resolved_to_a_tree():
    out = mindmap_for(MERGE)
    assert out is not None
    assert out.splitlines()[1] == "  root((Raw))"
    assert "RAG" in out and "LLM" in out


def test_decision_diamond_is_kept():
    assert mindmap_for(DECISION) is None


def test_inline_edge_label_is_kept():
    assert (
        mindmap_for("flowchart TD\n  A -- inline label --> B\n  A --> C\n  A --> D\n  A --> E\n")
        is None
    )


def test_subgraph_is_kept():
    assert mindmap_for(SUBGRAPH) is None


def test_unparseable_is_kept():
    assert mindmap_for("sequenceDiagram\n  A->>B: hi\n") is None
    assert mindmap_for("flowchart TD\n  A -- inline label --> B\n") is None


def test_rewrite_markdown_converts_only_convertible_fences():
    body = f"Intro.\n\n```mermaid\n{HUB}```\n\nMiddle.\n\n```mermaid\n{CHAIN}```\n"
    text, count = rewrite_markdown(body)
    assert count == 1
    assert "mindmap" in text
    assert "Intro." in text and "Middle." in text
    assert "Ingest" in text  # the chain is untouched


def _lesson(body: str) -> LessonOutput:
    return LessonOutput.model_validate(
        {
            "topic": "t",
            "level": "intro",
            "language": "en",
            "synopsis": "s",
            "learning_objectives": ["o"],
            "sections": [{"heading": "H", "body_markdown": body}],
            "key_takeaways": ["k"],
            "further_reading": [],
        }
    )


def test_shape_lesson_rewrites_and_revalidates():
    lesson, count = shape_lesson(_lesson(f"```mermaid\n{HUB}```"))
    assert count == 1
    assert isinstance(lesson, LessonOutput)
    assert "mindmap" in lesson.sections[0].body_markdown


def test_shape_lesson_unchanged_returns_same_object():
    original = _lesson(f"```mermaid\n{CHAIN}```")
    lesson, count = shape_lesson(original)
    assert count == 0
    assert lesson is original


def test_shape_topic_draft_converts_body_key():
    from backend.src.trust.generate_topic import _TopicDraft

    draft = _TopicDraft.model_validate(
        {
            "sections": [
                {"heading": "H", "body": f"Text.\n\n```mermaid\n{HUB}```", "sources": ["S1"]}
            ]
        }
    )
    shaped, count = shape_topic_draft(draft)
    assert count == 1
    assert "mindmap" in shaped.sections[0].body
    assert shaped.sections[0].sources == ["S1"]


def test_shape_topic_draft_unchanged_returns_same_object():
    from backend.src.trust.generate_topic import _TopicDraft

    draft = _TopicDraft.model_validate(
        {"sections": [{"heading": "H", "body": f"```mermaid\n{CHAIN}```", "sources": []}]}
    )
    shaped, count = shape_topic_draft(draft)
    assert count == 0
    assert shaped is draft
