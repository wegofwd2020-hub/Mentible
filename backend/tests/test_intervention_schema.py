"""Tests for intervention schema (sub-project 3)."""

from backend.src.analytics.models import CustomerResponseType


def test_customer_response_type_enum_has_four_values():
    """CustomerResponseType enum has exactly 4 values."""
    values = list(CustomerResponseType)
    assert len(values) == 4
    assert CustomerResponseType.RESUMED_JOURNEY.value == "resumed_journey"
    assert CustomerResponseType.UNSUBSCRIBED.value == "unsubscribed"
    assert CustomerResponseType.NO_RESPONSE.value == "no_response"
    assert CustomerResponseType.UNKNOWN.value == "unknown"


def test_customer_response_type_values_are_distinct():
    """All CustomerResponseType values are unique."""
    values = [e.value for e in CustomerResponseType]
    assert len(values) == len(set(values))
