import json

import pytest
from pydantic import ValidationError
from wegofwd_llm.errors import LLMError, LLMRateLimitError, LLMResponseError, LLMSchemaError

from backend.config import settings
from backend.src.trust.draft_prompt import build_draft_prompt
from backend.src.trust.generate import (
    _coerce_draft,
    _DraftOutput,
    cap_max_tokens,
    generate_draft,
    token_limit_message,
)
from backend.src.trust.schemas import DraftGenerateIn
from backend.tests.helpers import fake_provider


class _Src:
    def __init__(self, id, kind, title, content):
        self.id, self.kind, self.title, self.content = id, kind, title, content


_SOURCES = [
    _Src(
        "11111111-1111-1111-1111-111111111111",
        "transcript",
        "Interview",
        "We size pipes for the 10-year storm.",
    )
]

_GOOD = json.dumps(
    {
        "sections": [
            {
                "heading": "Design storm",
                "body": "Pipes are sized for the 10-year storm.",
                "sources": ["S1"],
            },
            {"heading": "Why", "body": "It balances cost and risk.", "sources": ["S1"]},
            {"heading": "Takeaway", "body": "Right-size, don't over-build.", "sources": []},
        ]
    }
)


def test_prompt_includes_sources_format_and_json():
    p = build_draft_prompt(_SOURCES, "guide", "stormwater", "engineers", "size pipes")
    assert "10-year storm" in p  # source content present
    assert "guide" in p  # format
    assert "S1" in p  # labelled source
    assert "json" in p.lower()


def test_generate_draft_returns_sections(monkeypatch):
    monkeypatch.setattr(
        "backend.src.trust.generate.build_provider",
        lambda *a, **k: fake_provider(text=_GOOD),
    )
    result = generate_draft(
        sources=_SOURCES,
        artifact_format="guide",
        topic="t",
        audience="a",
        goal="g",
        provider_id="anthropic",
        api_key="sk-ant-" + "x" * 20,
        model="m",
    )
    out = result.parsed
    assert isinstance(out, _DraftOutput)
    assert 1 <= len(out.sections) <= 6
    assert out.sections[0].heading == "Design storm"
    # generate_draft returns the full ConformanceResult (not just `.parsed`) so
    # the caller can meter observed token usage for managed generations.
    assert result.total_input_tokens > 0
    assert result.total_output_tokens > 0


def test_prompt_includes_guidance_when_present():
    p = build_draft_prompt(
        _SOURCES, "guide", "stormwater", "engineers", "size pipes", "focus on cost"
    )
    assert "focus on cost" in p


def test_prompt_omits_guidance_when_absent():
    base = build_draft_prompt(_SOURCES, "guide", "stormwater", "engineers", "size pipes")
    assert "Additional guidance" not in base


def test_request_validation():
    DraftGenerateIn(provider_id="anthropic")  # ok, managed (no key)
    DraftGenerateIn(api_key="sk-ant-" + "x" * 20)  # ok, BYOK
    with pytest.raises(Exception):  # noqa: B017 — any validation error is acceptable here
        DraftGenerateIn(provider_id="bogus")


def test_token_limit_message_groq_413_names_engine_and_fix():
    msg = token_limit_message("groq", LLMResponseError("groq returned HTTP 413"))
    assert msg is not None
    assert "Groq" in msg
    assert "8,000" in msg  # the free-tier limit is stated
    assert "Settings" in msg and "Engine" in msg  # points at the fix


def test_token_limit_message_groq_rate_limit():
    msg = token_limit_message("groq", LLMRateLimitError("groq rate limited"))
    assert msg is not None
    assert "per-minute" in msg
    assert "Engine" in msg


def test_token_limit_message_none_for_unrelated_errors():
    # A generic LLM error / schema failure is NOT a token limit → caller keeps its
    # own message.
    assert token_limit_message("groq", LLMError("boom")) is None
    assert token_limit_message("groq", LLMSchemaError("bad json")) is None
    assert token_limit_message("anthropic", LLMResponseError("500 upstream")) is None


def test_token_limit_message_non_groq_rate_limit_is_generic_but_named():
    msg = token_limit_message("anthropic", LLMRateLimitError("429"))
    assert msg is not None and "Claude" in msg  # named, but no free-tier Groq copy
    # a 413 on a paid provider falls through to the caller's generic message
    assert token_limit_message("anthropic", LLMResponseError("HTTP 413")) is None


def test_cap_max_tokens_clamps_groq_but_not_others(monkeypatch):
    # Groq's free tier caps tokens-per-minute (input+output); the output must stay
    # under it so input+output fits — otherwise the request is rejected 413.
    monkeypatch.setattr(settings, "groq_max_output_tokens", 5000)
    monkeypatch.setattr(settings, "groq_tpm_limit", 8000)
    assert cap_max_tokens("groq", 16384) == 5000  # flat cap, no prompt given
    assert cap_max_tokens("groq", 4000) == 4000  # already under the cap — untouched
    assert cap_max_tokens("anthropic", 16384) == 16384  # other providers uncapped


def test_cap_max_tokens_disabled_when_zero(monkeypatch):
    monkeypatch.setattr(settings, "groq_max_output_tokens", 0)
    monkeypatch.setattr(settings, "groq_tpm_limit", 0)
    assert cap_max_tokens("groq", 16384) == 16384  # both stages disabled


def test_cap_max_tokens_shrinks_output_for_a_large_prompt(monkeypatch):
    # The bug this fixes: a large-source topic (~3600 input tokens) + a flat 5000
    # output cap = 8600 > 8000 TPM → 413. The input-aware shrink drops the output
    # request so input+output fits the budget.
    monkeypatch.setattr(settings, "groq_max_output_tokens", 5000)
    monkeypatch.setattr(settings, "groq_tpm_limit", 8000)
    big_prompt = "x" * 14000  # ~5600 est input tokens (14000 / 2.5)
    capped = cap_max_tokens("groq", 16384, prompt=big_prompt)
    assert capped < 5000  # shrunk below the flat cap
    assert 4000 + capped < 8000  # input + output fits the TPM budget (with margin)


def test_cap_max_tokens_small_prompt_keeps_flat_cap(monkeypatch):
    monkeypatch.setattr(settings, "groq_max_output_tokens", 5000)
    monkeypatch.setattr(settings, "groq_tpm_limit", 8000)
    # A tiny prompt leaves plenty of budget → the flat 5000 cap still binds.
    assert cap_max_tokens("groq", 16384, prompt="short") == 5000


def test_cap_max_tokens_tpm_shrink_disabled_when_zero(monkeypatch):
    monkeypatch.setattr(settings, "groq_max_output_tokens", 5000)
    monkeypatch.setattr(settings, "groq_tpm_limit", 0)  # disable input-aware shrink
    assert cap_max_tokens("groq", 16384, prompt="x" * 14000) == 5000  # only flat cap


def test_cap_max_tokens_never_returns_below_floor(monkeypatch):
    # An input so large it eats the whole budget still returns a small positive
    # floor (the request will 413 anyway — genuinely too big for the free tier).
    monkeypatch.setattr(settings, "groq_max_output_tokens", 5000)
    monkeypatch.setattr(settings, "groq_tpm_limit", 8000)
    assert cap_max_tokens("groq", 16384, prompt="x" * 40000) >= 256


def test_prompt_linkedin_uses_linkedin_rules():
    p = build_draft_prompt(_SOURCES, "linkedin", None, None, None)
    assert "LinkedIn post" in p or "180-260" in p  # per-format length rule present
    assert "3 to 6 sections" not in p  # not the book default


def test_prompt_essay_uses_essay_rules():
    p = build_draft_prompt(_SOURCES, "essay", None, None, None)
    assert "800-1200" in p
    assert "3 to 6 sections" not in p


def test_prompt_book_unchanged_default():
    p = build_draft_prompt(_SOURCES, "book", None, None, None)
    assert "3 to 6 sections" in p


def test_prompt_unknown_format_falls_back_to_book():
    p = build_draft_prompt(_SOURCES, "totally_unknown", None, None, None)
    assert "3 to 6 sections" in p  # DEFAULT_SPEC == book


def test_coerce_draft_accepts_sections_as_json_string():
    """Some models double-encode the array — `sections` comes back as a JSON
    string instead of a list. The coercion decodes it before validating (same
    fix as the per-topic generator)."""
    section = {"heading": "Intro", "body": "Body text", "sources": ["S1"]}
    d = _coerce_draft({"sections": [section]})
    assert len(d.sections) == 1 and d.sections[0].heading == "Intro"
    d2 = _coerce_draft({"sections": json.dumps([section])})
    assert len(d2.sections) == 1 and d2.sections[0].body == "Body text"


def test_coerce_draft_rejects_a_non_json_string():
    """A truncated/garbage sections string can't be decoded — pydantic still
    raises (the repair loop then handles it), we don't silently swallow it."""
    with pytest.raises(ValidationError):
        _coerce_draft({"sections": '[{"heading": "h", "body": "trunca'})


def test_book_and_essay_drafts_get_grounded_diagram_guidance():
    for fmt in ("book", "essay"):
        p = build_draft_prompt(_SOURCES, fmt, None, None, None).lower()
        assert "mermaid" in p and "svg" in p
        # the multi-line rule that keeps diagrams parseable (see #402)
        assert "multi-line" in p or "own line" in p
        assert "single line" in p


def test_social_formats_get_no_diagram_guidance():
    for fmt in ("x_thread", "linkedin", "reel", "podcast"):
        p = build_draft_prompt(_SOURCES, fmt, None, None, None).lower()
        assert "mermaid" not in p
