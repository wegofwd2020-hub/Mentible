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
    out = _DerivativeOutput.model_validate(
        {"variants": [{"hook": "h", "body": "b", "hashtags": ["#a"], "cta": None}]}
    )
    assert out.variants[0].hook == "h"
