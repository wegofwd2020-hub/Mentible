import json

import pytest
from pydantic import ValidationError

from backend.src.trust.draft_prompt import build_draft_prompt
from backend.src.trust.generate import _coerce_draft, _DraftOutput, generate_draft
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
    out = generate_draft(
        sources=_SOURCES,
        artifact_format="guide",
        topic="t",
        audience="a",
        goal="g",
        provider_id="anthropic",
        api_key="sk-ant-" + "x" * 20,
        model="m",
    )
    assert isinstance(out, _DraftOutput)
    assert 1 <= len(out.sections) <= 6
    assert out.sections[0].heading == "Design storm"


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
