"""Tests for backend.src.derivatives.tts (P1-5 P4 — the audio narration TTS client).

The LLM seam (`wegofwd_llm`) is chat-completions only, so this is a NEW,
separate `httpx.AsyncClient` call to a vendor TTS endpoint (mirrors B3's
originality external-service situation) — patches httpx.AsyncClient directly,
never hits a live TTS vendor. ADR-001: the api_key travels ONLY in the
Authorization header and must never appear in a raised exception's message
or in captured logs.
"""

from __future__ import annotations

import logging

import httpx
import pytest

from backend.config import settings
from backend.src.derivatives.tts import (
    TTS_CAPABLE,
    TTSError,
    TTSProviderNotSupported,
    is_tts_available,
    synthesize_speech,
)

_API_KEY = "sk-TEST_FAKE_OPENAI_KEY_for_leak_detection_DO_NOT_REPLACE_xxxxxxxxxxxxxxxx"


class _FakeAsyncClient:
    """Stands in for httpx.AsyncClient as an async context manager."""

    def __init__(self, *, response=None, exc=None, capture=None, **init_kwargs):
        self._response = response
        self._exc = exc
        self._capture = capture
        if capture is not None:
            capture["init_kwargs"] = init_kwargs

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc_info):
        return False

    async def post(self, path, **kwargs):
        if self._capture is not None:
            self._capture["path"] = path
            self._capture["post_kwargs"] = kwargs
        if self._exc is not None:
            raise self._exc
        return self._response


def test_tts_capable_lists_openai_only():
    assert TTS_CAPABLE == frozenset({"openai"})


def test_is_tts_available_true_for_openai_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    assert is_tts_available("openai") is True


def test_is_tts_available_false_when_base_url_empty(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "")
    assert is_tts_available("openai") is False


def test_is_tts_available_false_for_non_tts_provider():
    assert is_tts_available("anthropic") is False


async def test_synthesize_speech_posts_to_the_right_url_with_key_in_header(monkeypatch, caplog):
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    capture: dict = {}
    fake_response = httpx.Response(200, content=b"ID3-fake-mp3-bytes")
    monkeypatch.setattr(
        "backend.src.derivatives.tts.httpx.AsyncClient",
        lambda **kw: _FakeAsyncClient(response=fake_response, capture=capture, **kw),
    )

    audio_bytes, char_count = await synthesize_speech(
        "Hello there.", provider_id="openai", api_key=_API_KEY, voice="alloy"
    )

    assert audio_bytes == b"ID3-fake-mp3-bytes"
    assert char_count == len("Hello there.")
    assert capture["path"] == "/audio/speech"
    assert capture["post_kwargs"]["headers"]["Authorization"] == f"Bearer {_API_KEY}"
    assert capture["post_kwargs"]["json"]["input"] == "Hello there."
    assert capture["post_kwargs"]["json"]["voice"] == "alloy"
    assert capture["init_kwargs"]["base_url"] == "https://api.openai.com/v1"
    assert _API_KEY not in caplog.text


async def test_synthesize_speech_raises_for_non_tts_provider():
    with pytest.raises(TTSProviderNotSupported):
        await synthesize_speech("x", provider_id="anthropic", api_key=_API_KEY, voice=None)


async def test_synthesize_speech_raises_when_dormant_config_disabled(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "")
    with pytest.raises(TTSProviderNotSupported):
        await synthesize_speech("x", provider_id="openai", api_key=_API_KEY, voice=None)


async def test_synthesize_speech_raises_tts_error_on_non_2xx(monkeypatch):
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    fake_response = httpx.Response(401, content=b"unauthorized")
    monkeypatch.setattr(
        "backend.src.derivatives.tts.httpx.AsyncClient",
        lambda **kw: _FakeAsyncClient(response=fake_response),
    )
    with pytest.raises(TTSError):
        await synthesize_speech("x", provider_id="openai", api_key=_API_KEY, voice=None)


async def test_synthesize_speech_key_never_leaks_on_transport_failure(monkeypatch, caplog):
    caplog.set_level(logging.WARNING)
    monkeypatch.setattr(settings, "tts_base_url_openai", "https://api.openai.com/v1")
    # A real httpx.Request carries the Authorization header — this is exactly
    # the leak risk the `from None` discipline in generate.py's
    # `_generate_post_with_image` guards against for the Anthropic SDK (ADR-001).
    req = httpx.Request(
        "POST",
        "https://api.openai.com/v1/audio/speech",
        headers={"Authorization": f"Bearer {_API_KEY}"},
    )
    exc = httpx.ConnectError("boom", request=req)
    monkeypatch.setattr(
        "backend.src.derivatives.tts.httpx.AsyncClient",
        lambda **kw: _FakeAsyncClient(exc=exc),
    )
    with pytest.raises(TTSError) as excinfo:
        await synthesize_speech("x", provider_id="openai", api_key=_API_KEY, voice=None)
    # The raised exception's own message must not carry the key — a caller
    # that logs str(exc) (the router does) must never leak it.
    assert _API_KEY not in str(excinfo.value)
    logging.getLogger("test").warning("tts failed: %s", excinfo.value)
    assert _API_KEY not in caplog.text
