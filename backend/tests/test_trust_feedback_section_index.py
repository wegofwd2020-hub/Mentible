"""Slice A of the trust review-loop finish (P0-2): `feedback.section_index`
lets a review comment pin to one section of an (immutable) version instead of
always being a whole-version note. Mirrors `test_trust_router.py`'s style —
real asyncpg DB via `DATABASE_URL`, FastAPI `TestClient` with the session
principal overridden."""

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


def _make_version(c, sections):
    owner = f"o-{uuid.uuid4()}"
    _as(owner, f"{owner}@x.z")
    pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
    art = c.post(
        f"/api/v1/trust/projects/{pid}/artifacts",
        json={"role": "cornerstone", "format": "book"},
    ).json()
    vid = c.post(
        f"/api/v1/trust/artifacts/{art['id']}/versions",
        json={"content": {"sections": sections}},
    ).json()["id"]
    return vid


def test_feedback_with_section_index_round_trips():
    with TestClient(app) as c:
        vid = _make_version(c, [{"heading": "Intro"}, {"heading": "Body"}])
        f = c.post(
            f"/api/v1/trust/versions/{vid}/feedback",
            json={"body": "fix this paragraph", "section_index": 1},
        ).json()
        assert f["section_index"] == 1
        detail = c.get(f"/api/v1/trust/versions/{vid}").json()
        assert detail["feedback"][0]["section_index"] == 1


def test_feedback_without_section_index_is_null_whole_version():
    with TestClient(app) as c:
        vid = _make_version(c, [{"heading": "Intro"}, {"heading": "Body"}])
        f = c.post(
            f"/api/v1/trust/versions/{vid}/feedback",
            json={"body": "overall looks good"},
        ).json()
        assert f["section_index"] is None
        detail = c.get(f"/api/v1/trust/versions/{vid}").json()
        assert detail["feedback"][0]["section_index"] is None


def test_feedback_section_index_out_of_range_422():
    with TestClient(app) as c:
        vid = _make_version(c, [{"heading": "Intro"}, {"heading": "Body"}])
        r = c.post(
            f"/api/v1/trust/versions/{vid}/feedback",
            json={"body": "bad index", "section_index": 2},
        )
        assert r.status_code == 422
        # negative index is also out of range
        r2 = c.post(
            f"/api/v1/trust/versions/{vid}/feedback",
            json={"body": "bad index", "section_index": -1},
        )
        assert r2.status_code == 422
