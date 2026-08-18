"""TDD for `PUT /api/v1/trust/projects/{id}/rights` (B3 Part B) — owner-only
rights attestation, DISPLAY-ONLY (never gates/blocks export). Mirrors
test_trust_router.py's test_put_and_get_project_toc for the owner-only PUT
shape."""

from __future__ import annotations

import os
import uuid

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


@pytest.fixture(autouse=True)
def _clear():
    yield
    app.dependency_overrides.clear()


def test_owner_attests_rights_and_it_surfaces_on_project_detail():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]

        r = c.put(
            f"/api/v1/trust/projects/{pid}/rights",
            json={"attested": True, "rights_holder": "Jane Doe"},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["rights_holder"] == "Jane Doe"
        assert body["rights_attested_at"] is not None

        got = c.get(f"/api/v1/trust/projects/{pid}").json()["project"]
        assert got["rights_holder"] == "Jane Doe"
        assert got["rights_attested_at"] is not None


def test_withdrawing_attestation_clears_the_timestamp():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        c.put(
            f"/api/v1/trust/projects/{pid}/rights", json={"attested": True, "rights_holder": "Jane"}
        )

        r = c.put(f"/api/v1/trust/projects/{pid}/rights", json={"attested": False})
        assert r.status_code == 200, r.text
        assert r.json()["rights_attested_at"] is None


def test_non_owner_cannot_attest_rights_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]

        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        r = c.put(
            f"/api/v1/trust/projects/{pid}/rights",
            json={"attested": True, "rights_holder": "Someone"},
        )
        assert r.status_code == 403


def test_new_project_starts_unattested():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        body = c.get(f"/api/v1/trust/projects/{pid}").json()["project"]
        assert body["rights_attested_at"] is None
        assert body["rights_holder"] is None
