"""Tests for the publish-card LLM-copy contract (P1-5 Task 2).

Covers: `CardRequest`'s exactly-one-source and known-provider validators,
`build_card_prompt`'s size-awareness, and `generate_card` returning the
`CardContent` contract. Patches only the provider seam (`build_provider`,
via `helpers.fake_provider`) so the REAL `generate_validated` + the real
`_validate` closure (`CardContent.model_validate(parse_json_response(...))`)
run — same discipline as `test_derivatives_generate.py`. No endpoint, no
rendering — that's Task 3.
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from wegofwd_llm import LLMSchemaError

from backend.src.derivatives import generate as gen
from backend.src.derivatives.prompt import build_card_prompt
from backend.src.derivatives.schemas import CardRequest
from backend.tests.helpers import fake_provider

_API_KEY = "sk-ant-xxxxxxxxxxxxxxxxxxxx"
_VERSION_ID = uuid.uuid4()

_GOOD = json.dumps(
    {"headline": "Stormwater, decoded", "subtext": "A short field guide.", "source_label": None}
)


def test_card_request_requires_exactly_one_source():
    CardRequest(source_text="hello", size="square")  # ok
    CardRequest(topic_version_id=_VERSION_ID, size="linkedin")  # ok
    with pytest.raises(ValidationError):
        CardRequest(size="square")  # neither
    with pytest.raises(ValidationError):
        CardRequest(source_text="x", topic_version_id=_VERSION_ID, size="square")  # both


def test_card_request_rejects_unknown_provider():
    with pytest.raises(ValidationError):
        CardRequest(source_text="hello", size="square", provider_id="not-a-real-provider")


def test_build_card_prompt_differs_by_size():
    story = build_card_prompt("src", "story", None)
    linkedin = build_card_prompt("src", "linkedin", None)
    square = build_card_prompt("src", "square", None)
    assert story != linkedin != square
    assert "PORTRAIT" in story
    assert "LANDSCAPE" in linkedin
    assert "SQUARE" in square


def test_generate_card_returns_contract_from_the_model(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        card = gen.generate_card(
            source_text="src",
            size="square",
            tone=None,
            provider_id="anthropic",
            api_key=_API_KEY,
            model="claude-sonnet-4-6",
        )
    assert card.headline == "Stormwater, decoded"
    assert card.subtext == "A short field guide."
    assert card.source_label is None
    assert _API_KEY not in caplog.text


def test_generate_card_repairs_then_succeeds(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(responses=["not json", _GOOD]),
    ):
        card = gen.generate_card(
            source_text="src",
            size="story",
            tone=None,
            provider_id="anthropic",
            api_key=_API_KEY,
            model="claude-sonnet-4-6",
        )
    assert card.headline == "Stormwater, decoded"
    assert _API_KEY not in caplog.text


def test_generate_card_raises_on_bad_output(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        with pytest.raises(LLMSchemaError):
            gen.generate_card(
                source_text="src",
                size="square",
                tone=None,
                provider_id="anthropic",
                api_key=_API_KEY,
                model="claude-sonnet-4-6",
            )
    assert _API_KEY not in caplog.text
