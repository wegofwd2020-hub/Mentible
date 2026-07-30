"""Schema tests for the optional reference image on DerivativeRequest (FR-1b)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from src.derivatives.schemas import DerivativeRequest, ReferenceImage


def test_image_optional_defaults_none():
    req = DerivativeRequest(source_text="s", api_key="sk-ant-" + "x" * 20)
    assert req.image is None


def test_image_accepts_valid():
    req = DerivativeRequest(
        source_text="s",
        api_key="sk-ant-" + "x" * 20,
        image={"media_type": "image/png", "data": "aGVsbG8="},
    )
    assert isinstance(req.image, ReferenceImage)
    assert req.image.media_type == "image/png"


def test_image_rejects_bad_media_type():
    with pytest.raises(ValidationError):
        DerivativeRequest(
            source_text="s",
            api_key="sk-ant-" + "x" * 20,
            image={"media_type": "image/gif", "data": "aGVsbG8="},
        )


def test_image_rejects_oversize_data():
    with pytest.raises(ValidationError):
        DerivativeRequest(
            source_text="s",
            api_key="sk-ant-" + "x" * 20,
            image={"media_type": "image/png", "data": "a" * 7_000_001},
        )
