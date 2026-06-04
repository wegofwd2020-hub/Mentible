"""Tests for the diagram-register control (the publication's "diagram direction").

Covers the pure prompt-builder piece: build_lesson_prompt selects the right
per-register guidance and always includes the shared flowchart role contract.
"""

from __future__ import annotations

from backend.src.generate.prompt_builder import (
    _DIAGRAM_REGISTERS,
    build_lesson_prompt,
)


def _prompt(**kw) -> str:
    base = {"topic": "Kinematics", "level": "student", "language": "en"}
    base.update(kw)
    return build_lesson_prompt(**base)


class TestDiagramRegister:
    def test_default_is_balanced(self):
        # No register arg → the balanced guidance, same as explicitly balanced.
        assert _prompt() == _prompt(diagram_register="balanced")
        assert "BALANCED direction" in _prompt()

    def test_conceptual_register_selected(self):
        p = _prompt(diagram_register="conceptual")
        assert "CONCEPTUAL direction" in p
        # conceptual steers AWAY from the granular technical diagram types
        assert "TECHNICAL direction" not in p
        assert "BALANCED direction" not in p

    def test_conceptual_register_offers_the_mermaid_conceptual_patterns(self):
        # The conceptual register teaches the model the Mermaid-expressible
        # conceptual patterns (mindmap / radial / funnel / quadrant) so a
        # conceptual book gets real infographics, not just flowcharts.
        p = _prompt(diagram_register="conceptual")
        assert "mindmap" in p
        assert "quadrantChart" in p
        for word in ("RADIAL", "FUNNEL", "QUADRANT", "MINDMAP"):
            assert word in p
        # ...and these native types should NOT leak into the other registers.
        assert "quadrantChart" not in _prompt(diagram_register="technical")
        assert "mindmap" not in _prompt(diagram_register="balanced")

    def test_technical_register_offers_the_precise_types(self):
        p = _prompt(diagram_register="technical")
        assert "TECHNICAL direction" in p
        assert "sequenceDiagram" in p
        assert "stateDiagram-v2" in p

    def test_unknown_register_falls_back_to_balanced(self):
        assert "BALANCED direction" in _prompt(diagram_register="nonsense")

    def test_role_contract_is_shared_by_every_register(self):
        # The flowchart colour-coding contract must appear regardless of register.
        for reg in _DIAGRAM_REGISTERS:
            p = _prompt(diagram_register=reg)
            assert ":::concept" in p
            assert "Do NOT write your own `classDef`" in p
