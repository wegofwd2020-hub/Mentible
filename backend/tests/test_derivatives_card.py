"""Tests for the publish-card LLM-copy contract (P1-5 Task 2).

Covers: `CardRequest`'s exactly-one-source validator, and `generate_card`
returning the `CardContent` contract from a mocked `generate_validated` call.
No endpoint, no rendering — that's Task 3.
"""

from unittest.mock import patch

import pytest
from pydantic import ValidationError

from backend.src.derivatives import generate as gen
from backend.src.derivatives.schemas import CardRequest


def test_card_request_requires_exactly_one_source():
    CardRequest(source_text="hello", size="square")  # ok
    CardRequest(topic_version_id="v1", size="linkedin")  # ok
    with pytest.raises(ValidationError):
        CardRequest(size="square")  # neither
    with pytest.raises(ValidationError):
        CardRequest(source_text="x", topic_version_id="v1", size="square")  # both


def test_generate_card_returns_contract_from_the_model():
    class _Res:
        parsed = type("C", (), {"headline": "H", "subtext": "S", "source_label": None})()

    with patch("backend.src.derivatives.generate.generate_validated", return_value=_Res()):
        card = gen.generate_card(
            source_text="src",
            size="square",
            tone=None,
            provider_id="anthropic",
            api_key="k",
            model="m",
        )
    assert card.headline == "H" and card.subtext == "S" and card.source_label is None
