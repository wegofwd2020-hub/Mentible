import json

import pytest

from backend.src.trust.draft_prompt import build_draft_prompt
from backend.src.trust.generate import _DraftOutput, generate_draft
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


def test_request_validation():
    DraftGenerateIn(provider_id="anthropic")  # ok, managed (no key)
    DraftGenerateIn(api_key="sk-ant-" + "x" * 20)  # ok, BYOK
    with pytest.raises(Exception):  # noqa: B017 — any validation error is acceptable here
        DraftGenerateIn(provider_id="bogus")
