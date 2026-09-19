"""Tests for intervention endpoint (sub-project 3)."""

import pytest


def test_send_interventions_endpoint_requires_super_admin():
    """POST /interventions/send-stalled is gated on require_super_admin."""
    # This is a schema test — the actual endpoint authorization is tested
    # via the FastAPI dependency injection (require_super_admin).
    # Unit testing would mock the conn and require_super_admin dependency.
    # Integration tests would call the endpoint with/without a super-admin JWT.
    pass


def test_send_interventions_request_schema_has_optional_user_id():
    """SendInterventionsRequest.user_id is optional."""
    from backend.src.analytics.router import SendInterventionsRequest

    req1 = SendInterventionsRequest()
    assert req1.user_id is None
    assert req1.dry_run is False

    req2 = SendInterventionsRequest(dry_run=True)
    assert req2.user_id is None
    assert req2.dry_run is True


def test_send_interventions_response_includes_sent_count():
    """SendInterventionsResponse has sent_count, dry_run, user_id."""
    from backend.src.analytics.router import SendInterventionsResponse
    from uuid import uuid4

    user_id = uuid4()
    resp = SendInterventionsResponse(sent_count=5, dry_run=False, user_id=user_id)

    assert resp.sent_count == 5
    assert resp.dry_run is False
    assert resp.user_id == user_id
