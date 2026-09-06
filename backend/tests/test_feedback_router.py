import os
import uuid
from unittest.mock import patch

import asyncpg
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def _as(sub, email):
    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=sub, email=email, issuer="test", is_super_admin=False
    )


def _valid_body():
    return {
        "name": "Jane Q",
        "company": "Acme",
        "role": "Founder",
        "type": "bug",
        "text": "the upload button did nothing",
        "contact_preference": "email_follow_up",
        "page": "/trust/abc",
    }


def test_submit_feedback_stores_row_with_server_email_and_json_payload():
    with TestClient(app) as c:
        sub, email = f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z"
        _as(sub, email)
        # email send is best-effort — mock it so the test never hits the network
        # send_feedback_email is async → patch auto-creates an AsyncMock.
        with patch("backend.src.feedback.router.send_feedback_email") as mock_email:
            r = c.post("/api/v1/feedback", json=_valid_body())
        assert r.status_code == 201, r.text
        fid = r.json()["id"]
        mock_email.assert_awaited_once()

    async def _check():
        conn = await asyncpg.connect(DSN)
        try:
            row = await conn.fetchrow("SELECT * FROM app_feedback WHERE id = $1", uuid.UUID(fid))
            assert row is not None
            assert row["email"] == email  # server-set from the principal, not the body
            assert row["name"] == "Jane Q"
            assert row["app"] == "mentible"
            assert row["page"] == "/trust/abc"
            import json as _json

            payload = (
                _json.loads(row["payload"]) if isinstance(row["payload"], str) else row["payload"]
            )
            assert payload["type"] == "bug"
            assert payload["text"] == "the upload button did nothing"
            assert payload["company"] == "Acme"
        finally:
            await conn.close()

    import asyncio

    asyncio.run(_check())


def test_submit_still_201_when_email_reports_failure():
    # The sender swallows its own errors and returns False; the endpoint must not
    # depend on a truthy return — the DB row is the primary record.
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z")
        with patch("backend.src.feedback.router.send_feedback_email", return_value=False):
            r = c.post("/api/v1/feedback", json=_valid_body())
        assert r.status_code == 201


def test_rejects_oversized_text_and_bad_enum():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"{uuid.uuid4()}@x.z")
        bad = _valid_body()
        bad["text"] = "x" * 2049
        assert c.post("/api/v1/feedback", json=bad).status_code == 422
        bad2 = _valid_body()
        bad2["type"] = "not_a_type"
        assert c.post("/api/v1/feedback", json=bad2).status_code == 422
