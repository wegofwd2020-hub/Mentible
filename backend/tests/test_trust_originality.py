from unittest.mock import patch

from backend.src.trust import originality

_API_KEY = "sk-ant-" + "k" * 20


class _Src:  # minimal stand-in for a ProjectInput row
    def __init__(self, id, content):
        self.id, self.content = id, content


def test_uncited_section_is_clean_without_an_llm_call():
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": []}]
    with patch("backend.src.trust.originality.generate_validated") as gv:
        rep, in_tok, out_tok = originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
        gv.assert_not_called()  # no cited source → nothing to compare against, no LLM call
    assert rep["summary"] == {"verbatim": 0, "paraphrase": 0, "clean": 1, "total": 1}
    assert rep["sections"][0]["overlap"] == "none"
    assert rep["sections"][0]["source_ref"] is None
    assert in_tok == 0 and out_tok == 0


def test_empty_body_section_is_clean_no_llm_call():
    sections = [{"heading": "H", "body": "   ", "source_ids": ["s1"]}]
    with patch("backend.src.trust.originality.generate_validated") as gv:
        rep, in_tok, out_tok = originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
        gv.assert_not_called()
    assert rep["sections"][0]["overlap"] == "none"
    assert in_tok == 0 and out_tok == 0


def test_cited_section_maps_the_model_label_back_to_the_real_source_id():
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": ["s1"]}]

    class _Res:  # mimic ConformanceResult
        parsed = type(
            "P", (), {"overlap": "verbatim", "note": "matches S1 word for word", "source_ref": "S1"}
        )()
        total_input_tokens = 120
        total_output_tokens = 45

    with patch("backend.src.trust.originality.generate_validated", return_value=_Res()):
        rep, in_tok, out_tok = originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "src text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
    sec = rep["sections"][0]
    assert sec["overlap"] == "verbatim"
    assert sec["source_ref"] == "s1"  # S1 label → real input id
    assert sec["note"] == "matches S1 word for word"
    assert rep["summary"] == {"verbatim": 1, "paraphrase": 0, "clean": 0, "total": 1}
    assert in_tok == 120 and out_tok == 45


def test_report_shape_keys():
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": []}]
    rep, _in_tok, _out_tok = originality.generate_originality(
        sections=sections,
        sources=[],
        provider_id="anthropic",
        api_key=_API_KEY,
        model="claude-sonnet-4-6",
    )
    assert set(rep.keys()) == {"sections", "summary"}
    assert set(rep["sections"][0].keys()) == {"index", "heading", "overlap", "note", "source_ref"}
    assert rep["sections"][0]["index"] == 0
    assert set(rep["summary"].keys()) == {"verbatim", "paraphrase", "clean", "total"}


def test_unknown_overlap_value_normalizes_to_verbatim_fail_safe():
    # Mirrors grounding._coerce's philosophy: an unparseable verdict must
    # never silently pass as clean — it normalizes to the state that
    # surfaces for human review, the same conservative direction grounding
    # takes when it normalizes an unknown claim status to "unsupported".
    out = originality._coerce({"overlap": "totally_bogus", "note": None, "source_ref": None})
    assert out.overlap == "verbatim"


def test_build_originality_prompt_includes_labels_and_content_and_asks_about_only_cited_sources():
    p = originality.build_originality_prompt("Intro", "Some body text.", [("S1", "source content")])
    assert "S1" in p
    assert "source content" in p
    assert "Some body text." in p
    assert "Intro" in p
    assert "json" in p.lower()
    assert "verbatim" in p and "paraphrase" in p


def test_the_submitted_key_never_appears_in_logs(caplog):
    # ADR-001, compute-path proof — mirrors test_derivatives_generate.py's
    # caplog assertion. The endpoint/worker-level proof (job status payload)
    # is Task 2's test_status_payload_never_contains_the_key_on_success twin.
    sections = [{"heading": "H", "body": "Some prose.", "source_ids": ["s1"]}]

    class _Res:
        parsed = type("P", (), {"overlap": "none", "note": None, "source_ref": None})()
        total_input_tokens = total_output_tokens = 0

    with patch("backend.src.trust.originality.generate_validated", return_value=_Res()):
        originality.generate_originality(
            sections=sections,
            sources=[_Src("s1", "src text")],
            provider_id="anthropic",
            api_key=_API_KEY,
            model="m",
        )
    assert _API_KEY not in caplog.text
