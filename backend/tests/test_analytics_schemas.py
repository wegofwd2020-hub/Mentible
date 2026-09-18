import pytest

from backend.src.analytics.schemas import EventIn, PrivacyViolation, validate_no_sensitive_fields


def test_rejects_manuscript_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"manuscript_excerpt": "once upon a time"})


def test_rejects_prompt_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"prompt": "write a story about..."})


def test_rejects_reviewer_comment_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"reviewer_comment_text": "needs work"})


def test_rejects_email_shaped_value_regardless_of_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"note": "contact me at jane@example.com"})


def test_rejects_payment_method_key():
    with pytest.raises(PrivacyViolation):
        validate_no_sensitive_fields({"payment_method": "visa"})


def test_allows_clean_properties():
    validate_no_sensitive_fields({"output_word_count": 512, "latency_ms": 4200})


def test_event_in_rejects_sensitive_properties_at_construction():
    with pytest.raises(ValueError):
        EventIn(
            event_name="sample_viewed",
            session_id="s-1",
            device_class="desktop",
            properties={"prompt": "leaked"},
        )


def test_event_in_accepts_clean_payload():
    ev = EventIn(
        event_name="sample_viewed",
        session_id="s-1",
        device_class="desktop",
        properties={"sample_id": "abc", "use_case": "book"},
    )
    assert ev.event_name == "sample_viewed"
    assert ev.event_id is not None
