"""The managed Groq key is read from the standard MANAGED_GROQ_API_KEY, or from
MENTIBLE_GROQ_KEY as a convenience alias (the name used in the local dev .env)."""

from __future__ import annotations

from backend.config import Settings


def test_mentible_groq_key_alias_populates_managed_groq(monkeypatch):
    monkeypatch.delenv("MANAGED_GROQ_API_KEY", raising=False)
    monkeypatch.setenv("MENTIBLE_GROQ_KEY", "gsk_alias_dummy")
    assert Settings().managed_groq_api_key == "gsk_alias_dummy"


def test_standard_managed_groq_api_key_still_works(monkeypatch):
    monkeypatch.delenv("MENTIBLE_GROQ_KEY", raising=False)
    monkeypatch.setenv("MANAGED_GROQ_API_KEY", "gsk_standard_dummy")
    assert Settings().managed_groq_api_key == "gsk_standard_dummy"


def test_groq_key_alias_also_populates_managed_groq(monkeypatch):
    monkeypatch.delenv("MANAGED_GROQ_API_KEY", raising=False)
    monkeypatch.delenv("MENTIBLE_GROQ_KEY", raising=False)
    monkeypatch.setenv("GROQ_KEY", "gsk_groqkey_dummy")
    assert Settings().managed_groq_api_key == "gsk_groqkey_dummy"


def test_standard_name_wins_when_both_set(monkeypatch):
    # AliasChoices lists managed_groq_api_key first, so the standard name wins.
    monkeypatch.setenv("MANAGED_GROQ_API_KEY", "gsk_standard_dummy")
    monkeypatch.setenv("MENTIBLE_GROQ_KEY", "gsk_alias_dummy")
    monkeypatch.setenv("GROQ_KEY", "gsk_groqkey_dummy")
    assert Settings().managed_groq_api_key == "gsk_standard_dummy"


def test_groq_default_model_is_a_live_groq_model(monkeypatch):
    # llama-3.3-70b-versatile was removed by Groq (404); the app default overrides
    # the stale registry default with a live model.
    assert Settings().groq_default_model == "qwen/qwen3.8-27b"
