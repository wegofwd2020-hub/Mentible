"""Tests for backend.src.derivatives.generate.generate_post (ADR-037 D8).

Patches the provider seam with `helpers.fake_provider` (same discipline as the
lesson worker tests) — never hits a live LLM. Mirrors the key-redaction
discipline of the /generate tests: the passed api_key must never appear in
captured logs.
"""

from __future__ import annotations

import json
from unittest.mock import patch

import pytest
from wegofwd_llm import LLMSchemaError

from backend.src.derivatives.generate import generate_post
from backend.tests.helpers import fake_provider

_API_KEY = "sk-ant-xxxxxxxxxxxxxxxxxxxx"

_GOOD = json.dumps(
    {
        "variants": [
            {"hook": "h1", "body": "b1", "hashtags": ["#a"], "cta": "Read more"},
            {"hook": "h2", "body": "b2", "hashtags": ["#b"], "cta": None},
            {"hook": "h3", "body": "b3", "hashtags": [], "cta": None},
        ]
    }
)


def test_generate_post_returns_variants(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text=_GOOD),
    ):
        out = generate_post(
            source_text="Stormwater.",
            platform="linkedin",
            tone=None,
            provider_id="anthropic",
            api_key=_API_KEY,
            model="claude-sonnet-4-6",
        )
    assert out.platform == "linkedin"
    assert len(out.variants) == 3
    assert out.variants[0].hook == "h1"
    assert out.provenance == "ai-generated"
    assert _API_KEY not in caplog.text


def test_generate_post_repairs_then_succeeds(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(responses=["not json", _GOOD]),
    ):
        out = generate_post(
            source_text="s",
            platform="x",
            tone=None,
            provider_id="anthropic",
            api_key=_API_KEY,
            model="claude-sonnet-4-6",
        )
    assert len(out.variants) == 3
    assert _API_KEY not in caplog.text


def test_generate_post_raises_on_bad_output(caplog):
    with patch(
        "backend.src.derivatives.generate.build_provider",
        return_value=fake_provider(text="never json"),
    ):
        with pytest.raises(LLMSchemaError):
            generate_post(
                source_text="s",
                platform="linkedin",
                tone=None,
                provider_id="anthropic",
                api_key=_API_KEY,
                model="claude-sonnet-4-6",
            )
    assert _API_KEY not in caplog.text
