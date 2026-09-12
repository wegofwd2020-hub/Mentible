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


def _make_feedback(c, text="please add export") -> str:
    from unittest.mock import patch

    app.dependency_overrides[require_active_user] = lambda: Principal(
        sub=f"u-{uuid.uuid4()}", email=f"{uuid.uuid4()}@x.z", issuer="test", is_super_admin=False
    )
    with patch("backend.src.feedback.router.send_feedback_email"):
        r = c.post(
            "/api/v1/feedback",
            json={
                "name": "Jane Q",
                "type": "feature",
                "text": text,
                "contact_preference": "feedback_only",
                "page": "/x",
            },
        )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_archive_unarchive_and_delete_roundtrip():
    with TestClient(app) as c:
        fid = _make_feedback(c, text="archive-roundtrip-marker")
        app.dependency_overrides[require_user] = lambda: Principal(
            sub="admin", email="a@x.z", issuer="test", is_super_admin=True
        )

        # archive → 204; drops from the default (active) list, shows under status=archived
        r = c.post(f"/api/v1/admin/feedback/{fid}/archive", json={"archived": True})
        assert r.status_code == 204, r.text
        active = c.get("/api/v1/admin/feedback?q=archive-roundtrip-marker").json()["rows"]
        assert all(row["id"] != fid for row in active)
        arch = c.get("/api/v1/admin/feedback?status=archived&q=archive-roundtrip-marker").json()[
            "rows"
        ]
        assert any(row["id"] == fid and row["archived"] for row in arch)

        # restore → 204; back in the active list, archived=False
        r = c.post(f"/api/v1/admin/feedback/{fid}/archive", json={"archived": False})
        assert r.status_code == 204
        active2 = c.get("/api/v1/admin/feedback?q=archive-roundtrip-marker").json()["rows"]
        assert any(row["id"] == fid and row["archived"] is False for row in active2)

        # hard delete → 204; detail now 404, second delete 404
        r = c.delete(f"/api/v1/admin/feedback/{fid}")
        assert r.status_code == 204
        assert c.get(f"/api/v1/admin/feedback/{fid}").status_code == 404
        assert c.delete(f"/api/v1/admin/feedback/{fid}").status_code == 404
    app.dependency_overrides.clear()


def test_archive_delete_require_super_admin():
    with TestClient(app) as c:
        fid = _make_feedback(c)
        # a non-super-admin principal is rejected by require_feedback_viewer
        app.dependency_overrides[require_user] = lambda: Principal(
            sub="u", email="u@x.z", issuer="test", is_super_admin=False
        )
        assert (
            c.post(f"/api/v1/admin/feedback/{fid}/archive", json={"archived": True}).status_code
            == 403
        )
        assert c.delete(f"/api/v1/admin/feedback/{fid}").status_code == 403
    app.dependency_overrides.clear()
