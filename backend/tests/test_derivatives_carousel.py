"""Tests for the carousel contract: schemas + generate_carousel (ADR-037 D8, P1-5 slice 2).

Patches the provider seam with `helpers.fake_provider` (same discipline as
`test_derivatives_generate.py`) — never hits a live LLM. Mirrors the
key-redaction discipline of the other derivatives tests: the passed api_key
must never appear in captured logs.
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import patch

import pytest
from pydantic import ValidationError
from wegofwd_llm import LLMSchemaError

from backend.src.derivatives import generate as gen
from backend.src.derivatives.schemas import CarouselRequest
from backend.tests.helpers import fake_provider

_VID = uuid.uuid4()


def test_carousel_request_requires_exactly_one_source():
    CarouselRequest(source_text="x")
    CarouselRequest(topic_version_id=_VID)
    with pytest.raises(ValidationError):
        CarouselRequest()
    with pytest.raises(ValidationError):
        CarouselRequest(source_text="x", topic_version_id=_VID)


def test_carousel_request_rejects_unknown_provider():
    with pytest.raises(ValidationError):
        CarouselRequest(source_text="x", provider_id="nope")


def test_generate_carousel_returns_four_to_eight_frames(caplog):
    frames = [{"headline": f"H{i}", "subtext": f"S{i}"} for i in range(5)]
    good = json.dumps({"frames": frames})
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(responses=[good]),
    ):
        out = gen.generate_carousel(
            source_text="src",
            tone=None,
            provider_id="anthropic",
            api_key="sk-ant-xxxxxxxxxxxxxxxxxxxx",
            model="m",
        )
    assert 4 <= len(out) <= 8
    assert out[0].headline == "H0"
    assert "sk-ant-xxxxxxxxxxxxxxxxxxxx" not in caplog.text


def test_generate_carousel_rejects_too_few_frames():
    bad = '{"frames": [{"headline":"H","subtext":"S"}]}'  # 1 frame < 4
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(responses=[bad, bad, bad]),
    ):
        with pytest.raises(LLMSchemaError):  # raised after repairs are exhausted
            gen.generate_carousel(
                source_text="src",
                tone=None,
                provider_id="anthropic",
                api_key="k",
                model="m",
            )
