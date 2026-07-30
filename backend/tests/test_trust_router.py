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


def test_session_sync_no_email_no_memberships():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", None)
        body = c.post("/api/v1/trust/session/sync").json()
        assert body["memberships"] == []


def test_session_sync_fresh_account_returns_account_and_empty():
    with TestClient(app) as c:
        email = f"u-{uuid.uuid4()}@x.z"
        _as(f"u-{uuid.uuid4()}", email)
        body = c.post("/api/v1/trust/session/sync").json()
        assert body["email"] == email
        assert body["account_id"]  # account resolved/created
        assert body["memberships"] == []  # no invites for this fresh email
        # idempotent
        assert c.post("/api/v1/trust/session/sync").json()["memberships"] == []


def test_owner_authoring_chain_and_non_owner_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "Guide", "topic": "t"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        assert art["role"] == "cornerstone"
        ver = c.post(
            f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {"t": "a"}}
        ).json()
        assert ver["version_no"] == 1
        # a different account is not the owner → 403 on artifact create
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "derivative", "format": "linkedin"},
        )
        assert r.status_code == 403


def test_bad_enum_422_and_unknown_artifact_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts", json={"role": "bogus", "format": "book"}
        )
        assert r.status_code == 422
        r2 = c.post(f"/api/v1/trust/artifacts/{uuid.uuid4()}/versions", json={"content": {}})
        assert r2.status_code == 404


def test_invite_then_reviewer_reads():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}})
        inv = c.post(
            f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email}
        ).json()
        assert inv["invited_email"] == expert_email and inv["role"] == "reviewer"
        # expert redeems then reads
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["my_role"] == "reviewer"
        assert detail["artifacts"][0]["versions"][0]["is_validated"] is False


def test_stranger_cannot_read_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        c.post("/api/v1/trust/session/sync")
        assert c.get(f"/api/v1/trust/projects/{pid}").status_code == 403


def test_reviewer_approval_is_expert_self():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}}).json()[
            "id"
        ]
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        ap = c.post(
            f"/api/v1/trust/versions/{vid}/approvals", json={"approved_at": "2026-07-27T00:00:00Z"}
        ).json()
        assert ap["recorded_via"] == "expert_self"
        assert ap["expert_name"] == expert_email  # from the reviewer's account
        # now validated
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["artifacts"][0]["versions"][0]["is_validated"] is True


def test_owner_approval_requires_expert_name():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}}).json()[
            "id"
        ]
        # owner records on an expert's behalf: missing expert_name → 422
        r = c.post(
            f"/api/v1/trust/versions/{vid}/approvals", json={"approved_at": "2026-07-27T00:00:00Z"}
        )
        assert r.status_code == 422
        ap = c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr X"},
        ).json()
        assert ap["recorded_via"] == "operator" and ap["expert_name"] == "Dr X"


def test_approval_unknown_version_404():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"u-{uuid.uuid4()}@x.z")
        r = c.post(
            f"/api/v1/trust/versions/{uuid.uuid4()}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z"},
        )
        assert r.status_code == 404


def test_reviewer_cannot_create_artifact_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        # expert logs in, redeems membership (becomes reviewer)
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        # reviewer attempts an OWNER-only action -> 403 (the need_owner gate, not the no-access branch)
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        )
        assert r.status_code == 403


def test_owned_projects_list_scoped():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        p1 = c.post("/api/v1/trust/projects", json={"title": "P1"}).json()["id"]
        p2 = c.post("/api/v1/trust/projects", json={"title": "P2"}).json()["id"]
        mine = c.get("/api/v1/trust/projects").json()
        ids = {p["id"] for p in mine}
        assert {p1, p2} <= ids
        assert all(p["status"] == "active" for p in mine if p["id"] in {p1, p2})
        # a different account does not see them
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        other = c.get("/api/v1/trust/projects").json()
        assert {p1, p2}.isdisjoint({p["id"] for p in other})


def test_version_summary_recorded_via():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": {}}).json()[
            "id"
        ]
        # before approval: not validated, no provenance
        v0 = c.get(f"/api/v1/trust/projects/{pid}").json()["artifacts"][0]["versions"][0]
        assert v0["is_validated"] is False and v0["recorded_via"] is None
        # owner records an operator approval
        c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr X"},
        )
        v1 = c.get(f"/api/v1/trust/projects/{pid}").json()["artifacts"][0]["versions"][0]
        assert v1["is_validated"] is True and v1["recorded_via"] == "operator"


def test_owner_adds_input_and_it_appears_in_detail():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "Stormwater", "topic": "runoff"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/inputs",
            json={"kind": "transcript", "title": "Interview 1", "content": "We size pipes for the 10-year storm."},
        )
        assert r.status_code == 200
        assert r.json()["kind"] == "transcript"
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert len(detail["inputs"]) == 1
        assert detail["inputs"][0]["title"] == "Interview 1"


def test_input_bad_kind_and_empty_content_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        assert c.post(f"/api/v1/trust/projects/{pid}/inputs",
                      json={"kind": "upload", "content": "x"}).status_code == 422  # blocked kind
        assert c.post(f"/api/v1/trust/projects/{pid}/inputs",
                      json={"kind": "note", "content": ""}).status_code == 422    # empty content


def test_reviewer_cannot_add_input_but_can_view():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "owner note"})
        expert_email = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        # expert redeems membership via session/sync, then reads
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["my_role"] == "reviewer"
        assert len(detail["inputs"]) == 1                # reviewer CAN see sources
        # reviewer CANNOT add
        r = c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "nope"})
        assert r.status_code == 403


def test_stranger_cannot_add_input():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        assert c.post(f"/api/v1/trust/projects/{pid}/inputs",
                      json={"kind": "note", "content": "x"}).status_code == 403
