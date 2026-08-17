from unittest.mock import patch

from backend.src.trust import grounding


class _Src:  # minimal stand-in for a ProjectInput row
    def __init__(self, id, content):
        self.id, self.content = id, content


def test_uncited_section_is_all_unsupported_without_an_llm_call():
    sections = [{"heading": "H", "body": "A claim.", "source_ids": []}]
    with patch("backend.src.trust.grounding.generate_validated") as gv:
        rep, in_tok, out_tok = grounding.generate_grounding(
            sections=sections,
            sources=[_Src("s1", "text")],
            provider_id="anthropic",
            api_key="k",
            model="m",
        )
        gv.assert_not_called()  # no cited source → no LLM call
    assert rep["claims_total"] == 1 and rep["unsupported"] == 1 and rep["supported"] == 0
    # No LLM call → no tokens spent (P1-4 T4 fix round 1 metering).
    assert in_tok == 0 and out_tok == 0


def test_cited_section_maps_labels_and_aggregates():
    sections = [{"heading": "H", "body": "A. B.", "source_ids": ["s1"]}]

    class _Res:  # mimic ConformanceResult
        parsed = type(
            "P",
            (),
            {
                "claims": [
                    type("C", (), {"text": "A.", "status": "supported", "sources": ["S1"]})(),
                    type("C", (), {"text": "B.", "status": "unsupported", "sources": []})(),
                ]
            },
        )()
        total_input_tokens = 120
        total_output_tokens = 45

    with patch("backend.src.trust.grounding.generate_validated", return_value=_Res()):
        rep, in_tok, out_tok = grounding.generate_grounding(
            sections=sections,
            sources=[_Src("s1", "src text")],
            provider_id="anthropic",
            api_key="k",
            model="m",
        )
    assert rep["claims_total"] == 2 and rep["supported"] == 1 and rep["unsupported"] == 1
    by = rep["by_section"][0]["claims"]
    assert by[0]["source_ids"] == ["s1"]  # S1 → real input id
    assert by[1]["source_ids"] == []
    # The cited section made one LLM call → its observed tokens are summed
    # into the totals (P1-4 T4 fix round 1 metering).
    assert in_tok == 120 and out_tok == 45


def test_empty_body_section_is_no_claims_no_llm_call():
    sections = [{"heading": "H", "body": "   ", "source_ids": ["s1"]}]
    with patch("backend.src.trust.grounding.generate_validated") as gv:
        rep, in_tok, out_tok = grounding.generate_grounding(
            sections=sections,
            sources=[_Src("s1", "text")],
            provider_id="anthropic",
            api_key="k",
            model="m",
        )
        gv.assert_not_called()
    assert rep["claims_total"] == 0
    assert rep["by_section"][0]["claims"] == []
    assert in_tok == 0 and out_tok == 0


def test_report_shape_keys_and_model():
    sections = [{"heading": "H", "body": "A claim.", "source_ids": []}]
    rep, _in_tok, _out_tok = grounding.generate_grounding(
        sections=sections,
        sources=[],
        provider_id="anthropic",
        api_key="k",
        model="claude-sonnet-4-6",
    )
    assert set(rep.keys()) == {
        "claims_total",
        "supported",
        "partial",
        "unsupported",
        "by_section",
        "model",
    }
    assert rep["model"] == "claude-sonnet-4-6"
    section_entry = rep["by_section"][0]
    assert set(section_entry.keys()) == {"section_index", "claims"}
    assert section_entry["section_index"] == 0


def test_unknown_source_label_from_model_is_dropped():
    sections = [{"heading": "H", "body": "A.", "source_ids": ["s1"]}]

    class _Res:
        parsed = type(
            "P",
            (),
            {
                "claims": [
                    type(
                        "C",
                        (),
                        {"text": "A.", "status": "supported", "sources": ["S1", "S99"]},
                    )()
                ]
            },
        )()
        total_input_tokens = total_output_tokens = 0

    with patch("backend.src.trust.grounding.generate_validated", return_value=_Res()):
        rep, _in_tok, _out_tok = grounding.generate_grounding(
            sections=sections,
            sources=[_Src("s1", "src text")],
            provider_id="anthropic",
            api_key="k",
            model="m",
        )
    assert rep["by_section"][0]["claims"][0]["source_ids"] == ["s1"]


def test_coerce_normalizes_an_unknown_status_to_unsupported():
    # `_coerce` runs inside the `_validate` closure passed to `generate_validated`
    # (unit-tested directly here since the tests above mock `generate_validated`
    # itself, which bypasses that closure).
    out = grounding._coerce({"claims": [{"text": "A.", "status": "totally_bogus", "sources": []}]})
    assert out.claims[0].status == "unsupported"


def test_build_grounding_prompt_includes_labels_and_content():
    p = grounding.build_grounding_prompt("Intro", "Some body text.", [("S1", "source content")])
    assert "S1" in p
    assert "source content" in p
    assert "Some body text." in p
    assert "Intro" in p
    assert "json" in p.lower()
