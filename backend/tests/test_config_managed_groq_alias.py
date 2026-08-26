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


def test_standard_name_wins_when_both_set(monkeypatch):
    # AliasChoices lists managed_groq_api_key first, so the standard name wins.
    monkeypatch.setenv("MANAGED_GROQ_API_KEY", "gsk_standard_dummy")
    monkeypatch.setenv("MENTIBLE_GROQ_KEY", "gsk_alias_dummy")
    assert Settings().managed_groq_api_key == "gsk_standard_dummy"
