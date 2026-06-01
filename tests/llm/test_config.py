"""Two-level (author + book) LLM config: precedence, author-as-ceiling for the
allow-list, provider/model coherence, version stamping into provenance, and
drift detection."""

from __future__ import annotations

import pytest

from pipeline.providers.config import (
    LLMConfig,
    ResolvedLLMConfig,
    is_stale,
    resolve_llm_config,
)
from pipeline.providers.errors import LLMConfigurationError, LLMNotAllowedError


# ── precedence: book > author > role default ─────────────────────────────────
def test_author_only_falls_back_to_role_default():
    r = resolve_llm_config(LLMConfig(version=3))
    assert (r.provider, r.model) == ("anthropic", "claude-sonnet-4-6")
    assert r.author_version == 3 and r.book_version is None


def test_author_default_overrides_role():
    r = resolve_llm_config(LLMConfig.of(provider="openai", version=2))
    assert r.provider == "openai" and r.model == "gpt-4o-mini"  # openai registry default


def test_book_overrides_author():
    author = LLMConfig.of(provider="openai", model="gpt-4o", version=5)
    book = LLMConfig.of(provider="deepseek", version=1)
    r = resolve_llm_config(author, book)
    assert r.provider == "deepseek"
    # author's model was for openai → NOT inherited onto deepseek
    assert r.model == "deepseek-chat"  # deepseek registry default
    assert r.author_version == 5 and r.book_version == 1


def test_book_overrides_only_model_on_inherited_provider():
    author = LLMConfig.of(provider="openai", model="gpt-4o", version=1)
    book = LLMConfig.of(model="gpt-4o-mini", version=7)  # no provider → inherits openai
    r = resolve_llm_config(author, book)
    assert r.provider == "openai" and r.model == "gpt-4o-mini"


# ── allow-list: author is the ceiling ────────────────────────────────────────
def test_allowed_intersection_author_is_ceiling():
    author = LLMConfig.of(allowed={"anthropic", "openai"}, version=1)
    book = LLMConfig.of(allowed={"openai", "deepseek"}, version=1)  # deepseek excluded by author
    r = resolve_llm_config(author, book, role="fast-draft")  # role default provider = openai
    assert r.allowed == frozenset({"openai"})
    assert r.provider == "openai"


def test_book_cannot_reenable_globally_excluded_provider():
    author = LLMConfig.of(allowed={"anthropic"}, version=1)
    # book tries to use openai, which the author globally excluded
    book = LLMConfig.of(allowed={"openai"}, provider="openai", version=1)
    with pytest.raises(LLMNotAllowedError):
        resolve_llm_config(author, book)


def test_unrestricted_when_neither_level_sets_allowed():
    r = resolve_llm_config(LLMConfig(version=1))
    assert r.allowed is None


def test_book_narrows_when_author_unrestricted():
    r = resolve_llm_config(
        LLMConfig(version=1), LLMConfig.of(allowed={"anthropic", "openai"}, version=2)
    )
    assert r.allowed == frozenset({"anthropic", "openai"})


def test_resolved_default_provider_must_be_within_effective_allowed():
    # author default provider is anthropic but allow-list excludes it → error
    author = LLMConfig.of(allowed={"openai"}, provider="anthropic", version=1)
    with pytest.raises(LLMNotAllowedError):
        resolve_llm_config(author)


def test_unknown_provider_raises_config_error():
    with pytest.raises(LLMConfigurationError):
        resolve_llm_config(LLMConfig.of(provider="bogus", version=1))


# ── versioning / provenance ──────────────────────────────────────────────────
def test_provenance_carries_both_config_versions_and_fingerprint():
    author = LLMConfig.of(provider="anthropic", version=4)
    book = LLMConfig.of(model="claude-sonnet-4-6", version=9)
    prov = resolve_llm_config(author, book).provenance()
    assert prov["provider"] == "anthropic"
    assert prov["author_config_version"] == 4
    assert prov["book_config_version"] == 9
    assert "contract_version" in prov and "integration_version" in prov
    assert len(prov["config_fingerprint"]) == 16


def test_fingerprint_changes_with_effective_choice_only():
    base = resolve_llm_config(LLMConfig.of(provider="openai", version=1))
    # different version number, SAME effective choice -> same fingerprint
    same = resolve_llm_config(LLMConfig.of(provider="openai", version=99))
    assert base.fingerprint() == same.fingerprint()
    # different model -> different fingerprint
    diff = resolve_llm_config(LLMConfig.of(provider="openai", model="gpt-4o", version=1))
    assert base.fingerprint() != diff.fingerprint()


# ── drift detection ──────────────────────────────────────────────────────────
def test_is_stale_false_when_unchanged():
    r = resolve_llm_config(LLMConfig.of(provider="anthropic", version=2))
    assert is_stale(r.provenance(), r) is False


def test_is_stale_true_when_config_version_bumped():
    old = resolve_llm_config(LLMConfig.of(provider="anthropic", version=2)).provenance()
    new = resolve_llm_config(LLMConfig.of(provider="anthropic", version=3))
    assert is_stale(old, new) is True


def test_is_stale_true_when_model_changes():
    old = resolve_llm_config(LLMConfig.of(provider="openai", model="gpt-4o", version=1)).provenance()
    new = resolve_llm_config(LLMConfig.of(provider="openai", model="gpt-4o-mini", version=1))
    assert is_stale(old, new) is True
