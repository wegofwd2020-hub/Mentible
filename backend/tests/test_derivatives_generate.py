"""Tests for backend.src.derivatives.generate.generate_post (ADR-037 D8).

Patches the provider seam with `helpers.fake_provider` (same discipline as the
lesson worker tests) — never hits a live LLM. Mirrors the key-redaction
discipline of the /generate tests: the passed api_key must never appear in
captured logs.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import anthropic
import httpx
import pytest
from wegofwd_llm import LLMSchemaError
from wegofwd_llm.errors import LLMAuthError, LLMRateLimitError

from backend.src.derivatives.generate import generate_post
from backend.src.derivatives.schemas import ReferenceImage
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


_GOOD_JSON = (
    '{"variants": ['
    '{"hook":"h0","body":"b0","hashtags":["#x"],"cta":null},'
    '{"hook":"h1","body":"b1","hashtags":["#x"],"cta":null},'
    '{"hook":"h2","body":"b2","hashtags":["#x"],"cta":null}]}'
)


def _fake_anthropic(text):
    block = MagicMock()
    block.type = "text"
    block.text = text
    client = MagicMock()
    client.messages.create.return_value = MagicMock(content=[block])
    factory = MagicMock(return_value=client)
    return factory, client


def _sdk_status_error(cls, message="anthropic error"):
    """Build a real instance of an anthropic SDK APIStatusError subclass.

    Mirrors what the live SDK raises: the response (and therefore the
    originating httpx.Request, which can carry the Authorization/x-api-key
    header) is attached to the exception — this is exactly why the vision
    helper re-raises with `from None` rather than `from e`.
    """
    request = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
    response = httpx.Response(status_code=cls.status_code, request=request)
    return cls(message, response=response, body=None)


def test_vision_path_returns_variants_and_sends_image(caplog):
    factory, client = _fake_anthropic(_GOOD_JSON)
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        out = generate_post(
            source_text="Stormwater.",
            platform="linkedin",
            tone=None,
            provider_id="anthropic",
            api_key=_API_KEY,
            model="claude-x",
            image=img,
        )
    assert len(out.variants) == 3
    assert out.provenance == "ai-generated"
    # The image block reached the SDK call.
    sent = client.messages.create.call_args.kwargs["messages"][0]["content"]
    assert any(b.get("type") == "image" for b in sent)
    # BYOK key went only to the client factory, not into the response.
    factory.assert_called_once_with(api_key=_API_KEY)
    assert _API_KEY not in caplog.text
    # Base64 image data must not leak into the response.
    assert "aGk=" not in json.dumps(out.model_dump())


def test_vision_bad_json_raises_schema_error(caplog):
    factory, _ = _fake_anthropic("not json at all")
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        with pytest.raises(LLMSchemaError):
            generate_post(
                source_text="s",
                platform="x",
                tone=None,
                provider_id="anthropic",
                api_key=_API_KEY,
                model="claude-x",
                image=img,
            )
    assert _API_KEY not in caplog.text


def test_vision_authentication_error_maps_to_llm_auth_error(caplog):
    factory, client = _fake_anthropic(_GOOD_JSON)
    client.messages.create.side_effect = _sdk_status_error(anthropic.AuthenticationError)
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        with pytest.raises(LLMAuthError):
            generate_post(
                source_text="s",
                platform="x",
                tone=None,
                provider_id="anthropic",
                api_key=_API_KEY,
                model="claude-x",
                image=img,
            )
    assert _API_KEY not in caplog.text


def test_vision_permission_denied_error_maps_to_llm_auth_error(caplog):
    factory, client = _fake_anthropic(_GOOD_JSON)
    client.messages.create.side_effect = _sdk_status_error(anthropic.PermissionDeniedError)
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        with pytest.raises(LLMAuthError):
            generate_post(
                source_text="s",
                platform="x",
                tone=None,
                provider_id="anthropic",
                api_key=_API_KEY,
                model="claude-x",
                image=img,
            )
    assert _API_KEY not in caplog.text


def test_vision_rate_limit_error_maps_to_llm_rate_limit_error(caplog):
    factory, client = _fake_anthropic(_GOOD_JSON)
    client.messages.create.side_effect = _sdk_status_error(anthropic.RateLimitError)
    img = ReferenceImage(media_type="image/png", data="aGk=")
    with patch("backend.src.derivatives.generate.anthropic.Anthropic", factory):
        with pytest.raises(LLMRateLimitError):
            generate_post(
                source_text="s",
                platform="x",
                tone=None,
                provider_id="anthropic",
                api_key=_API_KEY,
                model="claude-x",
                image=img,
            )
    assert _API_KEY not in caplog.text
