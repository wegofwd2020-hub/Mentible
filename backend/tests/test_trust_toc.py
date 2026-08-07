import json

from backend.src.trust.toc_prompt import build_toc_prompt
from backend.src.trust.toc_suggest import _TocOutput, suggest_toc
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
        "subjects": [
            {
                "subject_label": "Design basics",
                "topics": [
                    {"title": "Sizing for the storm", "sources": ["S1"]},
                ],
            }
        ]
    }
)


def test_toc_prompt_grounded_and_labels_sources():
    p = build_toc_prompt(_SOURCES, "stormwater", "engineers", "size pipes")
    assert "10-year storm" in p  # source content present
    assert "S1" in p  # labelled source
    assert "Invent nothing" in p  # grounding discipline
    assert "json" in p.lower()


def test_suggest_toc_returns_subjects(monkeypatch):
    monkeypatch.setattr(
        "backend.src.trust.toc_suggest.build_provider",
        lambda *a, **k: fake_provider(text=_GOOD),
    )
    out = suggest_toc(
        sources=_SOURCES,
        topic="t",
        audience="a",
        goal="g",
        provider_id="anthropic",
        api_key="sk-ant-" + "x" * 20,
        model="m",
    )
    assert isinstance(out, _TocOutput)
    assert 1 <= len(out.subjects) <= 6
    assert out.subjects[0].subject_label == "Design basics"
    assert out.subjects[0].topics[0].sources == ["S1"]
