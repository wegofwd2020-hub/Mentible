"""Diagram-type selection: the prompt tells the model to pick each diagram's
type from its content, rather than defaulting to a flowchart.
"""

from __future__ import annotations

from backend.src.generate.prompt_builder import (
    _DIAGRAM_REGISTERS,
    _diagram_guidelines,
    build_lesson_prompt,
)


def test_type_selection_rules_present_for_every_register():
    for register in _DIAGRAM_REGISTERS:
        text = _diagram_guidelines(register)
        assert "Do NOT default to a flowchart" in text, register
        assert "mindmap" in text and "quadrant diagram" in text, register
        assert "MUST be a native Mermaid `mindmap`" in text, register
        assert "STEP 3" in text and "STEP 2" in text, register
        assert "three or more spokes" in text, register


def test_layered_structure_is_steered_to_mindmap():
    text = _diagram_guidelines("balanced")
    assert "a layered architecture is a mindmap" in text
    assert "root((Five-Layer Framework))" in text


def test_type_selection_reaches_the_lesson_prompt():
    prompt = build_lesson_prompt(topic="Kinematics", level="student", language="en")
    assert "Choose each diagram's TYPE from its content" in prompt


def test_register_specific_guidance_is_kept():
    # The register block still follows the shared rules, so per-register
    # guidance (e.g. the conceptual mindmap example) is not lost.
    assert "Core idea" in _diagram_guidelines("conceptual")
    assert "root((Indra))" in _diagram_guidelines("balanced")
