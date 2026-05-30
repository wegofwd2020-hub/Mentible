"""Tests for the Anthropic caller wrapper.

These tests mock the vendored AnthropicProvider class directly, so no real
Anthropic SDK call is made. The wrapper's job is to route the call and to
keep error paths key-safe.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest

from backend.src.generate.anthropic_caller import (
    AnthropicCallError,
    call_anthropic,
    parse_json_response,
)

# ── Happy path ────────────────────────────────────────────────────────────────


def test_call_anthropic_success(known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        instance = MockProvider.return_value
        instance.generate.return_value = ('{"topic": "x"}', 100, 200)

        result = call_anthropic(
            api_key=known_test_api_key,
            prompt="some prompt",
            model="claude-sonnet-4-6",
        )

    assert result == '{"topic": "x"}'
    MockProvider.assert_called_once_with(api_key=known_test_api_key, model="claude-sonnet-4-6")
    instance.generate.assert_called_once_with("some prompt", max_tokens=16384)


def test_call_anthropic_passes_custom_max_tokens(known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        instance = MockProvider.return_value
        instance.generate.return_value = ('{"topic": "x"}', 1, 1)

        call_anthropic(
            api_key=known_test_api_key,
            prompt="p",
            model="claude-sonnet-4-6",
            max_tokens=32000,
        )

    instance.generate.assert_called_once_with("p", max_tokens=32000)


# ── Error paths ───────────────────────────────────────────────────────────────


def test_empty_api_key_rejected():
    with pytest.raises(AnthropicCallError, match="missing api_key"):
        call_anthropic(api_key="", prompt="x", model="claude-sonnet-4-6")


def test_sdk_exception_translated_to_AnthropicCallError(known_test_api_key, capsys):
    """When the SDK raises, we re-raise our own exception with NO chained context.
    The original exception (which may stringify the api_key) must not appear."""
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        instance = MockProvider.return_value
        # Simulate an SDK exception that contains the api_key in its message.
        instance.generate.side_effect = RuntimeError(
            f"upstream rejected request with key {known_test_api_key}"
        )

        with pytest.raises(AnthropicCallError) as excinfo:
            call_anthropic(
                api_key=known_test_api_key,
                prompt="x",
                model="claude-sonnet-4-6",
            )

    # Our raised exception's string must NOT contain the api_key
    err_text = str(excinfo.value)
    assert known_test_api_key not in err_text
    # And the cause chain is suppressed (`raise from None`)
    assert excinfo.value.__cause__ is None


def test_provider_constructor_failure(known_test_api_key):
    with patch("backend.src.generate.anthropic_caller.AnthropicProvider") as MockProvider:
        MockProvider.side_effect = RuntimeError("boom")

        with pytest.raises(AnthropicCallError, match="Anthropic call failed"):
            call_anthropic(
                api_key=known_test_api_key,
                prompt="x",
                model="claude-sonnet-4-6",
            )


# ── parse_json_response ──────────────────────────────────────────────────────


def test_parse_clean_json():
    out = parse_json_response('{"a": 1, "b": "hello"}')
    assert out == {"a": 1, "b": "hello"}


def test_parse_strips_code_fence():
    text = '```json\n{"a": 1}\n```'
    assert parse_json_response(text) == {"a": 1}


def test_parse_strips_bare_fence():
    text = '```\n{"a": 1}\n```'
    assert parse_json_response(text) == {"a": 1}


def test_parse_invalid_json():
    with pytest.raises(AnthropicCallError, match="invalid JSON"):
        parse_json_response("not json")
