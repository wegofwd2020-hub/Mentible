"""Tests for the audio-narration LLM-copy contract (P1-5 P4).

Covers `build_narration_prompt`'s speakable-prose instructions and
`generate_narration` returning the `NarrationContent` contract. Patches only
the provider seam (`build_provider`, via `helpers.fake_provider`) so the REAL
`generate_validated` + the real `_validate` closure
(`NarrationContent.model_validate(parse_json_response(...))`) run — same
discipline as `test_derivatives_card.py`. No TTS, no endpoint — those are
this same task's `tts.py` tests and Task 2's endpoint tests.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from wegofwd_llm import LLMSchemaError

from backend.src.derivatives import generate as gen
from backend.src.derivatives.prompt import build_narration_prompt
from backend.tests.helpers import fake_provider

_API_KEY = "sk-ant-xxxxxxxxxxxxxxxxxxxx"

_GOOD = json.dumps(
    {
        "title": "Stormwater, decoded",
        "script": "Water always finds the lowest point. That single idea explains most of what a stormwater system does.",
    }
)


def test_build_narration_prompt_asks_for_speakable_prose_and_strips_markup():
    prompt = build_narration_prompt("## Heading\n\nSome **bold** text. [1]", None)
    assert "no markdown" in prompt.lower()
    assert "no citation markers" in prompt.lower()
    assert "60-90" in prompt


def test_build_narration_prompt_includes_tone_when_given():
    with_tone = build_narration_prompt("src", "warm")
    without_tone = build_narration_prompt("src", None)
    assert "Tone: warm." in with_tone
    assert "Tone:" not in without_tone


def test_generate_narration_returns_contract_from_the_model(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        out = gen.generate_narration(
            source_text="Stormwater basics.",
            tone=None,
            provider_id="openai",
            api_key=_API_KEY,
            model="gpt-4o-mini",
        )
    assert out.title == "Stormwater, decoded"
    assert "lowest point" in out.script
    assert _API_KEY not in caplog.text


def test_generate_narration_repairs_then_succeeds(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(responses=["not json", _GOOD]),
    ):
        out = gen.generate_narration(
            source_text="src",
            tone="warm",
            provider_id="openai",
            api_key=_API_KEY,
            model="gpt-4o-mini",
        )
    assert out.title == "Stormwater, decoded"
    assert _API_KEY not in caplog.text


def test_generate_narration_raises_on_bad_output(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        with pytest.raises(LLMSchemaError):
            gen.generate_narration(
                source_text="src",
                tone=None,
                provider_id="openai",
                api_key=_API_KEY,
                model="gpt-4o-mini",
            )
    assert _API_KEY not in caplog.text
