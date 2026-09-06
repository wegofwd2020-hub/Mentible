import os
import uuid

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def test_list_and_detail_roundtrip():
    with TestClient(app) as c:
        email = f"{uuid.uuid4()}@x.z"
        app.dependency_overrides[require_active_user] = lambda: Principal(
            sub=f"u-{uuid.uuid4()}", email=email, issuer="test", is_super_admin=False
        )
        from unittest.mock import patch

        with patch("backend.src.feedback.router.send_feedback_email"):
            r = c.post(
                "/api/v1/feedback",
                json={
                    "name": "Jane Q",
                    "type": "bug",
                    "text": "the upload button did nothing",
                    "contact_preference": "schedule_call",
                    "page": "/trust/abc",
                },
            )
        assert r.status_code == 201, r.text
        fid = r.json()["id"]

        app.dependency_overrides[require_user] = lambda: Principal(
            sub="admin", email="a@x.z", issuer="test", is_super_admin=True
        )
        lst = c.get("/api/v1/admin/feedback?type=bug&q=upload")
        assert lst.status_code == 200, lst.text
        assert any(row["id"] == fid for row in lst.json()["rows"])
        det = c.get(f"/api/v1/admin/feedback/{fid}")
        assert det.status_code == 200
        body = det.json()
        assert body["text"] == "the upload button did nothing"
        assert body["payload"]["contact_preference"] == "schedule_call"
    app.dependency_overrides.clear()
