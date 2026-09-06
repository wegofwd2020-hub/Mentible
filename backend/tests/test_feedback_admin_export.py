import os
import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal

DSN = os.environ.get("DATABASE_URL", "")
pytestmark = pytest.mark.skipif(not DSN, reason="DATABASE_URL not set")


def test_export_csv_and_json():
    with TestClient(app) as c:
        email = f"{uuid.uuid4()}@x.z"
        app.dependency_overrides[require_active_user] = lambda: Principal(
            sub=f"u-{uuid.uuid4()}", email=email, issuer="test", is_super_admin=False)
        feedback_text = f"export probe {uuid.uuid4()} the payload decode must round-trip"
        with patch("backend.src.feedback.router.send_feedback_email"):
            r = c.post("/api/v1/feedback", json={
                "name": "Jane Q", "type": "bug", "text": feedback_text,
                "contact_preference": "schedule_call", "page": "/trust/abc"})
        assert r.status_code == 201, r.text

        app.dependency_overrides[require_user] = lambda: Principal(
            sub="admin", email="a@x.z", issuer="test", is_super_admin=True)

        csv_r = c.get(f"/api/v1/admin/feedback/export?format=csv&q={email}")
        assert csv_r.status_code == 200, csv_r.text
        assert csv_r.headers["content-type"].startswith("text/csv")
        assert "attachment" in csv_r.headers["content-disposition"]
        assert "created_at,name,email" in csv_r.text
        # Proves the jsonb payload was actually decoded (not silently emptied).
        assert feedback_text in csv_r.text

        json_r = c.get(f"/api/v1/admin/feedback/export?format=json&q={email}")
        assert json_r.status_code == 200, json_r.text
        assert json_r.headers["content-type"].startswith("application/json")
        body = json_r.json()
        assert isinstance(body, list)
        assert any(rec["text"] == feedback_text for rec in body)
    app.dependency_overrides.clear()


def test_export_csv_neutralizes_formula_injection():
    with TestClient(app) as c:
        email = f"{uuid.uuid4()}@x.z"
        app.dependency_overrides[require_active_user] = lambda: Principal(
            sub=f"u-{uuid.uuid4()}", email=email, issuer="test", is_super_admin=False)
        danger_text = "=1+2 danger"
        with patch("backend.src.feedback.router.send_feedback_email"):
            r = c.post("/api/v1/feedback", json={
                "name": "Jane Q", "type": "bug", "text": danger_text,
                "contact_preference": "schedule_call", "page": "/trust/abc"})
        assert r.status_code == 201, r.text

        app.dependency_overrides[require_user] = lambda: Principal(
            sub="admin", email="a@x.z", issuer="test", is_super_admin=True)

        csv_r = c.get(f"/api/v1/admin/feedback/export?format=csv&q={email}")
        assert csv_r.status_code == 200, csv_r.text
        # Neutralized: a leading single-quote defuses the formula for a spreadsheet.
        assert "'=1+2 danger" in csv_r.text
        # Never a raw formula-triggering cell start.
        assert "\n=1+2" not in csv_r.text
        assert ",=1+2" not in csv_r.text
    app.dependency_overrides.clear()
