import pytest
from pydantic import ValidationError

from backend.src.derivatives.prompt import build_derivative_prompt
from backend.src.derivatives.schemas import (
    DerivativeRequest,
    _DerivativeOutput,
)


def test_prompt_scopes_to_platform_and_source():
    p = build_derivative_prompt("Stormwater basics.", "linkedin")
    assert "Stormwater basics." in p
    assert "linkedin" in p.lower()
    assert "json" in p.lower()  # the "respond with ONLY valid JSON" tail
    x = build_derivative_prompt("Stormwater basics.", "x")
    assert "280" in x  # the X char-limit rule appears


def test_request_validation():
    DerivativeRequest(source_text="hi", platform="linkedin")  # ok, managed (no key)
    DerivativeRequest(source_text="hi", api_key="sk-ant-" + "x" * 20)  # ok, BYOK
    with pytest.raises(ValidationError):
        DerivativeRequest(source_text="")  # min_length
    with pytest.raises(ValidationError):
        DerivativeRequest(source_text="hi", provider_id="bogus")  # unknown provider


def test_output_model():
    # The contract is exactly 3 variants (enforced structurally).
    out = _DerivativeOutput.model_validate(
        {
            "variants": [
                {"hook": f"h{i}", "body": "b", "hashtags": ["#a"], "cta": None} for i in range(3)
            ]
        }
    )
    assert out.variants[0].hook == "h0"
    with pytest.raises(ValidationError):  # wrong count → rejected → repair loop
        _DerivativeOutput.model_validate(
            {"variants": [{"hook": "h", "body": "b", "hashtags": ["#a"], "cta": None}]}
        )


def test_reference_guidance_present_when_flagged():
    p = build_derivative_prompt("src", "linkedin", has_reference=True)
    assert "reference image" in p.lower()
    assert "do not" in p.lower() and "reproduce" in p.lower()


def test_no_reference_guidance_by_default():
    p = build_derivative_prompt("src", "linkedin")
    assert "reference image" not in p.lower()


def test_default_output_byte_identical_to_pre_change():
    """Golden test: verify has_reference=False produces byte-identical output to pre-change."""
    expected = (
        "You are a social-media editor. Using ONLY the source material below, write 3 distinct "
        "linkedin posts that PROMOTE it. Do not invent facts beyond the source; the posts market "
        "the source, they do not add claims.\n\n"
        "Platform rules: Professional but human. Each post <= 3000 characters. 3-5 relevant hashtags. End with a clear call to action.\n\n"
        'SOURCE:\n"""\ntest content\n"""\n\n'
        "Respond with ONLY valid JSON, no prose, exactly matching this schema:\n"
        '{"variants": [{"hook": "string", "body": "string", "hashtags": ["#tag"], "cta": "string or null"}]}\n'
        "Return exactly 3 variants."
    )
    actual = build_derivative_prompt("test content", "linkedin", has_reference=False)
    assert actual == expected, f"Mismatch:\nExpected:\n{expected}\n\nActual:\n{actual}"
