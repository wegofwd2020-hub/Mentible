import asyncio
import json as _json
import os
import uuid
from unittest.mock import patch

import asyncpg
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.tests.helpers import fake_provider
from src.trust import topic_repo

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


def test_owner_can_withdraw_approval_flips_validation_back():
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
        # withdrawing before any approval → 409
        assert (
            c.post(f"/api/v1/trust/versions/{vid}/approvals/withdraw", json={}).status_code == 409
        )
        c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr X"},
        )
        assert c.get(f"/api/v1/trust/versions/{vid}").json()["is_validated"] is True
        wd = c.post(f"/api/v1/trust/versions/{vid}/approvals/withdraw", json={})
        assert wd.status_code == 200
        assert wd.json()["action"] == "withdraw" and wd.json()["expert_name"] == "Dr X"
        detail = c.get(f"/api/v1/trust/versions/{vid}").json()
        assert detail["is_validated"] is False and detail["recorded_via"] is None


def test_feedback_records_revision_note_and_appears_in_version_detail():
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
        # empty body → 422
        assert (
            c.post(f"/api/v1/trust/versions/{vid}/feedback", json={"body": "  "}).status_code == 422
        )
        # owner note → operator
        of = c.post(
            f"/api/v1/trust/versions/{vid}/feedback", json={"body": "tighten the intro"}
        ).json()
        assert of["author_kind"] == "operator"
        # reviewer note → expert
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        rf = c.post(f"/api/v1/trust/versions/{vid}/feedback", json={"body": "add a source"}).json()
        assert rf["author_kind"] == "expert" and rf["author_name"] == expert_email
        # both notes surface on the version detail, in order
        detail = c.get(f"/api/v1/trust/versions/{vid}").json()
        assert [f["body"] for f in detail["feedback"]] == ["tighten the intro", "add a source"]


def test_feedback_unknown_version_404():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"u-{uuid.uuid4()}@x.z")
        r = c.post(f"/api/v1/trust/versions/{uuid.uuid4()}/feedback", json={"body": "hi"})
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
        pid = c.post(
            "/api/v1/trust/projects", json={"title": "Stormwater", "topic": "runoff"}
        ).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/inputs",
            json={
                "kind": "transcript",
                "title": "Interview 1",
                "content": "We size pipes for the 10-year storm.",
            },
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
        assert (
            c.post(
                f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "upload", "content": "x"}
            ).status_code
            == 422
        )  # blocked kind
        assert (
            c.post(
                f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": ""}
            ).status_code
            == 422
        )  # empty content


def test_reviewer_cannot_add_input_but_can_view():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        c.post(
            f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "owner note"}
        )
        expert_email = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        # expert redeems membership via session/sync, then reads
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert detail["my_role"] == "reviewer"
        assert len(detail["inputs"]) == 1  # reviewer CAN see sources
        # reviewer CANNOT add
        r = c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "nope"})
        assert r.status_code == 403


def test_stranger_cannot_add_input():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        assert (
            c.post(
                f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "x"}
            ).status_code
            == 403
        )


def _seed_project_with_input(c, owner):
    _as(owner, f"{owner}@x.z")
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    iid = c.post(
        f"/api/v1/trust/projects/{pid}/inputs",
        json={"kind": "note", "title": "T", "content": "body here"},
    ).json()["id"]
    return pid, iid


def test_edit_and_delete_uncited_input():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        # edit title + content on an uncited input
        r = c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "T2", "content": "new body"})
        assert r.status_code == 200, r.text
        assert r.json()["title"] == "T2" and r.json()["content"] == "new body"
        # delete uncited → 204, gone
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 204
        inputs = c.get(f"/api/v1/trust/projects/{pid}").json()["inputs"]
        assert all(i["id"] != iid for i in inputs)


def test_cited_input_guards_content_edit_and_delete_but_allows_title():
    # Reconciled for the "block only on a validated citing version" rule (see
    # test_source_cited_only_by_unvalidated_draft_is_editable_and_deletable
    # for the unapproved-citation case, which now succeeds instead of 409-ing):
    # this test now approves the citing version so it still exercises the block.
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        # create an artifact + a version whose content cites this input id
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(
            f"/api/v1/trust/artifacts/{art['id']}/versions",
            json={"content": {"sections": [{"heading": "H", "body": "B", "source_ids": [iid]}]}},
        ).json()["id"]
        # approve the citing version so it's validated (and thus a guard-worthy citation)
        c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-07-27T00:00:00Z", "expert_name": "Dr X"},
        )
        # content edit blocked
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "x"}).status_code == 409
        # delete blocked
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 409
        # title edit allowed even when cited
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "renamed"}).status_code == 200
        # still present
        assert any(i["id"] == iid for i in c.get(f"/api/v1/trust/projects/{pid}").json()["inputs"])


def _cite_input_in_new_version(c, artifact_id, input_id):
    return c.post(
        f"/api/v1/trust/artifacts/{artifact_id}/versions",
        json={"content": {"sections": [{"heading": "H", "body": "B", "source_ids": [input_id]}]}},
    ).json()["id"]


def test_source_cited_only_by_unvalidated_draft_is_editable_and_deletable():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        _cite_input_in_new_version(c, art["id"], iid)  # cited, but NOT approved
        # content edit + delete now SUCCEED (only an unvalidated draft cites it)
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "new"}).status_code == 200
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 204


def test_source_cited_by_validated_version_is_blocked_then_unlocks_after_withdraw():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        pid, iid = _seed_project_with_input(c, owner)
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = _cite_input_in_new_version(c, art["id"], iid)
        # approve the citing version (owner records on a named expert's behalf)
        c.post(
            f"/api/v1/trust/versions/{vid}/approvals",
            json={"approved_at": "2026-08-07T00:00:00Z", "expert_name": "Dr. X"},
        )
        # now content edit + delete are BLOCKED; title still allowed
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "x"}).status_code == 409
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 409
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "t"}).status_code == 200
        # WITHDRAW the approval → the source unlocks
        c.post(f"/api/v1/trust/versions/{vid}/approvals/withdraw", json={})
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"content": "ok"}).status_code == 200


def test_input_edit_delete_owner_only_and_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _pid, iid = _seed_project_with_input(c, owner)
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")  # non-member
        assert c.patch(f"/api/v1/trust/inputs/{iid}", json={"title": "z"}).status_code == 403
        assert c.delete(f"/api/v1/trust/inputs/{iid}").status_code == 403
        _as(owner, f"{owner}@x.z")
        assert (
            c.patch(f"/api/v1/trust/inputs/{uuid.uuid4()}", json={"title": "z"}).status_code == 404
        )


_DRAFT_JSON = _json.dumps(
    {
        "sections": [
            {"heading": "A", "body": "b", "sources": ["S1"]},
            {"heading": "C", "body": "d", "sources": []},
            {"heading": "E", "body": "f", "sources": ["S1"]},
        ]
    }
)


def _artifact_with_source(c):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    art = c.post(
        f"/api/v1/trust/projects/{pid}/artifacts", json={"role": "cornerstone", "format": "guide"}
    ).json()
    c.post(f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"})
    return pid, art["id"]


def test_owner_generates_draft_version():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, aid = _artifact_with_source(c)
        with patch(
            "backend.src.trust.generate.build_provider",
            return_value=fake_provider(text=_DRAFT_JSON),
        ):
            r = c.post(
                f"/api/v1/trust/artifacts/{aid}/versions/generate",
                json={"api_key": "sk-ant-" + "x" * 20},
            )
        assert r.status_code == 200
        assert r.json()["version_no"] == 1
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        assert (
            detail["artifacts"][0]["versions"][0]["is_validated"] is False
        )  # a real version exists


def test_generate_requires_a_source_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        aid = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "guide"},
        ).json()["id"]
        r = c.post(
            f"/api/v1/trust/artifacts/{aid}/versions/generate",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
        assert r.status_code == 422  # no sources


def test_generate_key_never_leaks_and_reviewer_forbidden():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, aid = _artifact_with_source(c)
        key = "sk-ant-" + "y" * 20
        with patch(
            "backend.src.trust.generate.build_provider",
            return_value=fake_provider(text=_DRAFT_JSON),
        ):
            r = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": key})
        assert key not in _json.dumps(r.json())
        # reviewer cannot generate
        expert = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert})
        _as(f"e-{uuid.uuid4()}", expert)
        c.post("/api/v1/trust/session/sync")
        rr = c.post(f"/api/v1/trust/artifacts/{aid}/versions/generate", json={"api_key": key})
        assert rr.status_code == 403


def test_generate_bad_model_output_502():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        _pid, aid = _artifact_with_source(c)
        with patch(
            "backend.src.trust.generate.build_provider",
            return_value=fake_provider(text="not json"),
        ):
            r = c.post(
                f"/api/v1/trust/artifacts/{aid}/versions/generate",
                json={"api_key": "sk-ant-" + "z" * 20},
            )
        assert r.status_code == 502


_TOC_JSON = _json.dumps(
    {
        "subjects": [
            {
                "subject_label": "Design basics",
                "topics": [
                    {
                        "title": "Sizing for the storm",
                        "subtopics": [
                            {"label": "A", "detail": "d"},
                            {"label": "B"},
                        ],
                        "sources": ["S1"],
                    },
                    {"title": "Unattributed idea", "sources": []},
                ],
            }
        ]
    }
)


def test_owner_suggests_toc_from_sources():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _aid = _artifact_with_source(c)
        key = "sk-ant-" + "x" * 20
        with patch(
            "backend.src.trust.toc_suggest.build_provider",
            return_value=fake_provider(text=_TOC_JSON),
        ):
            r = c.post(
                f"/api/v1/trust/projects/{pid}/suggest-toc",
                json={"api_key": key},
            )
        assert r.status_code == 200
        assert key not in r.text  # ADR-001: the submitted key never leaks into the response
        toc = r.json()["toc"]
        subjects = toc["subjects"]
        assert len(subjects) == 1
        units = subjects[0]["units"]
        assert len(units) == 2
        # first unit cites the real input id (not the S1 label)
        assert units[0]["source_ids"] != []
        assert all(len(sid) == 36 for sid in units[0]["source_ids"])  # real uuids
        assert units[1]["source_ids"] == []  # unattributed topic → no source_ids
        # first unit's subtopics: object when the model gave a detail, bare string otherwise
        assert units[0]["subtopics"] == [{"label": "A", "detail": "d"}, "B"]
        assert units[1]["subtopics"] == []
        for u in units:
            assert u["prerequisites"] == []
            assert "id" in u


def test_suggest_toc_requires_a_source_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/suggest-toc",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
        assert r.status_code == 422  # no sources


def test_suggest_toc_reviewer_forbidden():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _aid = _artifact_with_source(c)
        expert = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert})
        _as(f"e-{uuid.uuid4()}", expert)
        c.post("/api/v1/trust/session/sync")
        r = c.post(
            f"/api/v1/trust/projects/{pid}/suggest-toc",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
        assert r.status_code == 403


def test_get_version_owner_reviewer_read_stranger_403_and_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        owner_email = f"{owner}@x.z"
        _as(owner, owner_email)
        pid = c.post("/api/v1/trust/projects", json={"title": "Guide", "topic": "t"}).json()["id"]
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        vid = c.post(
            f"/api/v1/trust/artifacts/{art['id']}/versions",
            json={"content": {"sections": [{"heading": "H", "body": "B", "source_ids": []}]}},
        ).json()["id"]

        # owner reads content
        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200
        body = r.json()
        assert body["content"]["sections"][0]["heading"] == "H"
        assert body["is_validated"] is False

        # invite a reviewer, redeem membership, reviewer can read
        reviewer = f"r-{uuid.uuid4()}"
        reviewer_email = f"{reviewer}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": reviewer_email})
        _as(reviewer, reviewer_email)
        c.post("/api/v1/trust/session/sync")  # redeem invite → membership
        assert c.get(f"/api/v1/trust/versions/{vid}").status_code == 200

        # a stranger is 403
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        assert c.get(f"/api/v1/trust/versions/{vid}").status_code == 403

        # unknown version is 404
        _as(owner, owner_email)
        assert c.get(f"/api/v1/trust/versions/{uuid.uuid4()}").status_code == 404


def test_put_and_get_project_toc():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        toc = {
            "subjects": [
                {
                    "subject_label": "S",
                    "units": [
                        {
                            "id": "t1",
                            "title": "Topic 1",
                            "subtopics": [],
                            "prerequisites": [],
                            "source_ids": [],
                        }
                    ],
                }
            ]
        }
        assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200
        got = c.get(f"/api/v1/trust/projects/{pid}").json()["project"]["toc"]
        assert got["subjects"][0]["units"][0]["title"] == "Topic 1"
        # reviewer/non-owner blocked
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 403


def test_create_essay_artifact_accepted():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        r = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "essay"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["format"] == "essay"


_TOPIC_DRAFT_JSON = _json.dumps(
    {
        "sections": [
            {"heading": "Staff", "body": "The staff has five lines.", "sources": ["S1"]},
        ]
    }
)


def _project_with_toc_topic(c, topic_id="t1", source_ids=None):
    pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
    iid = c.post(
        f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"}
    ).json()["id"]
    sids = source_ids if source_ids is not None else [iid]
    toc = {
        "subjects": [
            {
                "subject_label": "S",
                "units": [
                    {
                        "id": topic_id,
                        "title": "Reading music",
                        "subtopics": ["Staff & clef"],
                        "prerequisites": [],
                        "source_ids": sids,
                    }
                ],
            }
        ]
    }
    assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200
    return pid, iid


def test_owner_generates_topic_version():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, iid = _project_with_toc_topic(c)
        key = "sk-ant-" + "x" * 20
        with patch(
            "backend.src.trust.generate_topic.build_provider",
            return_value=fake_provider(text=_TOPIC_DRAFT_JSON),
        ):
            r = c.post(
                f"/api/v1/trust/projects/{pid}/topics/t1/generate",
                json={"api_key": key},
            )
        assert r.status_code == 200, r.text
        assert key not in r.text  # ADR-001: the submitted key never leaks into the response
        body = r.json()
        assert body["topic_id"] == "t1"
        assert body["title"] == "Reading music"
        assert body["version_no"] == 1
        assert body["content"]["sections"][0]["heading"] == "Staff"
        assert body["content"]["sections"][0]["source_ids"] == [iid]


def test_generate_topic_version_stores_generation_meta():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, iid = _project_with_toc_topic(c)
        key = "sk-ant-" + "x" * 20
        with patch(
            "backend.src.trust.generate_topic.build_provider",
            return_value=fake_provider(text=_TOPIC_DRAFT_JSON),
        ):
            r = c.post(
                f"/api/v1/trust/projects/{pid}/topics/t1/generate",
                json={"api_key": key, "guidance": "keep it concise"},
            )
        assert r.status_code == 200, r.text
        version_id = r.json()["id"]

        async def _fetch():
            conn = await asyncpg.connect(DSN)
            try:
                return await topic_repo.get_topic_version(
                    conn, topic_version_id=uuid.UUID(version_id)
                )
            finally:
                await conn.close()

        tv = asyncio.run(_fetch())
        assert tv.generation_meta["kind"] == "topic_draft"
        assert tv.generation_meta["provider_id"] == "anthropic"
        assert tv.generation_meta["source_input_ids"] == [iid]
        assert tv.generation_meta["guidance"] == "keep it concise"


def test_generate_topic_unknown_topic_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        r = c.post(
            f"/api/v1/trust/projects/{pid}/topics/does-not-exist/generate",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
        assert r.status_code == 404


def test_generate_topic_no_sources_422():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c, source_ids=[])
        r = c.post(
            f"/api/v1/trust/projects/{pid}/topics/t1/generate",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
        assert r.status_code == 422


def test_generate_topic_reviewer_forbidden():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        expert = f"e-{uuid.uuid4()}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert})
        _as(f"e-{uuid.uuid4()}", expert)
        c.post("/api/v1/trust/session/sync")
        r = c.post(
            f"/api/v1/trust/projects/{pid}/topics/t1/generate",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
        assert r.status_code == 403


def test_generate_topic_bad_model_output_502():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        with patch(
            "backend.src.trust.generate_topic.build_provider",
            return_value=fake_provider(text="not json"),
        ):
            r = c.post(
                f"/api/v1/trust/projects/{pid}/topics/t1/generate",
                json={"api_key": "sk-ant-" + "z" * 20},
            )
        assert r.status_code == 502


def _topic_version_id(c, pid, topic_id="t1"):
    """Owner-perspective helper: generate a topic_version and return its id.
    Assumes `_as(owner, ...)` is already the active principal."""
    with patch(
        "backend.src.trust.generate_topic.build_provider",
        return_value=fake_provider(text=_TOPIC_DRAFT_JSON),
    ):
        r = c.post(
            f"/api/v1/trust/projects/{pid}/topics/{topic_id}/generate",
            json={"api_key": "sk-ant-" + "x" * 20},
        )
    assert r.status_code == 200, r.text
    return r.json()["id"]


def test_reviewer_topic_approval_is_expert_self():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        ap = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z"},
        ).json()
        assert ap["recorded_via"] == "expert_self"
        assert ap["expert_name"] == expert_email
        assert ap["topic_version_id"] == tvid


def test_owner_topic_approval_requires_expert_name():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)
        r = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z"},
        )
        assert r.status_code == 422
        ap = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr X"},
        ).json()
        assert ap["recorded_via"] == "operator" and ap["expert_name"] == "Dr X"


def test_topic_approval_unknown_topic_version_404():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"u-{uuid.uuid4()}@x.z")
        r = c.post(
            f"/api/v1/trust/topic-versions/{uuid.uuid4()}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z"},
        )
        assert r.status_code == 404


def test_topic_approval_non_member_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        r = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr X"},
        )
        assert r.status_code == 403


def test_owner_can_withdraw_topic_approval_flips_validation_back():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)
        # withdrawing before any approval -> 409
        assert (
            c.post(f"/api/v1/trust/topic-versions/{tvid}/approvals/withdraw", json={}).status_code
            == 409
        )
        c.post(
            f"/api/v1/trust/topic-versions/{tvid}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr X"},
        )
        wd = c.post(f"/api/v1/trust/topic-versions/{tvid}/approvals/withdraw", json={})
        assert wd.status_code == 200
        assert wd.json()["action"] == "withdraw" and wd.json()["expert_name"] == "Dr X"
        # withdrawing again (already withdrawn) -> 409
        assert (
            c.post(f"/api/v1/trust/topic-versions/{tvid}/approvals/withdraw", json={}).status_code
            == 409
        )


def _toc_two_topics(c, pid, iid):
    toc = {
        "subjects": [
            {
                "subject_label": "S",
                "units": [
                    {
                        "id": "t1",
                        "title": "Topic 1",
                        "subtopics": ["A"],
                        "prerequisites": [],
                        "source_ids": [iid],
                    },
                    {
                        "id": "t2",
                        "title": "Topic 2",
                        "subtopics": ["B"],
                        "prerequisites": [],
                        "source_ids": [iid],
                    },
                ],
            }
        ]
    }
    assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200


def test_project_detail_topic_status_and_book_validated():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        iid = c.post(
            f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"}
        ).json()["id"]
        _toc_two_topics(c, pid, iid)

        # nothing generated yet -> both not_generated, book not validated
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        statuses = {s["topic_id"]: s["status"] for s in detail["topic_status"]}
        assert statuses == {"t1": "not_generated", "t2": "not_generated"}
        assert detail["book_validated"] is False
        by_topic = {s["topic_id"]: s for s in detail["topic_status"]}
        assert by_topic["t1"]["latest_version_id"] is None
        assert by_topic["t1"]["version_no"] is None
        assert by_topic["t2"]["latest_version_id"] is None
        assert by_topic["t2"]["version_no"] is None

        # generate t1, generate (not validate) t2
        tv1 = _topic_version_id(c, pid, topic_id="t1")
        _topic_version_id(c, pid, topic_id="t2")

        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        statuses = {s["topic_id"]: s["status"] for s in detail["topic_status"]}
        assert statuses == {"t1": "drafted", "t2": "drafted"}
        assert detail["book_validated"] is False
        by_topic = {s["topic_id"]: s for s in detail["topic_status"]}
        assert by_topic["t1"]["latest_version_id"] == tv1
        assert by_topic["t1"]["version_no"] == 1

        # validate t1 only
        c.post(
            f"/api/v1/trust/topic-versions/{tv1}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr X"},
        )
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        statuses = {s["topic_id"]: s["status"] for s in detail["topic_status"]}
        assert statuses == {"t1": "validated", "t2": "drafted"}
        assert detail["book_validated"] is False

        # validate t2 too -> book_validated flips true
        tv2 = _topic_version_id(c, pid, topic_id="t2")
        c.post(
            f"/api/v1/trust/topic-versions/{tv2}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr Y"},
        )
        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        statuses = {s["topic_id"]: s["status"] for s in detail["topic_status"]}
        assert statuses == {"t1": "validated", "t2": "validated"}
        assert detail["book_validated"] is True


def test_project_detail_topic_status_excludes_orphan_versions():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        iid = c.post(
            f"/api/v1/trust/projects/{pid}/inputs", json={"kind": "note", "content": "a source"}
        ).json()["id"]
        _toc_two_topics(c, pid, iid)
        _topic_version_id(c, pid, topic_id="t1")
        _topic_version_id(c, pid, topic_id="t2")

        # a topic_version for a topic id NOT in the current toc — inserted directly,
        # since /topics/{id}/generate 404s for a topic not present in the toc.
        async def _insert_orphan():
            conn = await asyncpg.connect(DSN)
            try:
                await topic_repo.create_topic_version(
                    conn,
                    project_id=uuid.UUID(pid),
                    topic_id="tX",
                    title="Orphan",
                    source_ids=[],
                    content={"sections": []},
                    created_by_sub=owner,
                )
            finally:
                await conn.close()

        asyncio.run(_insert_orphan())

        detail = c.get(f"/api/v1/trust/projects/{pid}").json()
        statuses = {s["topic_id"]: s["status"] for s in detail["topic_status"]}
        assert statuses == {"t1": "drafted", "t2": "drafted"}
        assert "tX" not in statuses
        assert detail["book_validated"] is False


def test_topic_version_detail_owner_reviewer_read_stranger_403_and_404():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        owner_email = f"{owner}@x.z"
        _as(owner, owner_email)
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)

        # owner reads content, not yet validated
        r = c.get(f"/api/v1/trust/topic-versions/{tvid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["topic_id"] == "t1"
        assert body["content"]["sections"][0]["heading"] == "Staff"
        assert body["is_validated"] is False
        assert body["recorded_via"] is None
        # generated via _topic_version_id() -> generation_meta was stored on generate
        assert body["generation_meta"]["kind"] == "topic_draft"

        # a topic_version created without generation_meta -> null on the detail response
        async def _insert_no_meta():
            conn = await asyncpg.connect(DSN)
            try:
                return await topic_repo.create_topic_version(
                    conn,
                    project_id=uuid.UUID(pid),
                    topic_id="t1",
                    title="No meta",
                    source_ids=[],
                    content={"sections": []},
                    created_by_sub=owner,
                )
            finally:
                await conn.close()

        no_meta_tv = asyncio.run(_insert_no_meta())
        r = c.get(f"/api/v1/trust/topic-versions/{no_meta_tv.id}")
        assert r.status_code == 200, r.text
        assert r.json()["generation_meta"] is None

        # owner approves on a named expert's behalf -> validated + recorded_via
        ap = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr X"},
        )
        assert ap.status_code == 200, ap.text
        r = c.get(f"/api/v1/trust/topic-versions/{tvid}")
        assert r.status_code == 200
        body = r.json()
        assert body["is_validated"] is True
        assert body["recorded_via"] == "operator"

        # invite a reviewer, redeem membership, reviewer can read
        reviewer = f"r-{uuid.uuid4()}"
        reviewer_email = f"{reviewer}@x.z"
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": reviewer_email})
        _as(reviewer, reviewer_email)
        c.post("/api/v1/trust/session/sync")  # redeem invite -> membership
        assert c.get(f"/api/v1/trust/topic-versions/{tvid}").status_code == 200

        # a stranger is 403
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        assert c.get(f"/api/v1/trust/topic-versions/{tvid}").status_code == 403

        # unknown topic version is 404
        _as(owner, owner_email)
        assert c.get(f"/api/v1/trust/topic-versions/{uuid.uuid4()}").status_code == 404


def test_topic_versions_list_endpoint():
    """GET /projects/{id}/topics/{topic_id}/versions returns only that topic's
    versions (excludes a sibling topic's versions), each with is_validated,
    ordered by version_no, and 403s for a non-member (mirrors the topic-version
    detail access test above)."""
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        owner_email = f"{owner}@x.z"
        _as(owner, owner_email)
        pid, _iid = _project_with_toc_topic(c)
        _toc_two_topics(c, pid, _iid)

        tv1 = _topic_version_id(c, pid, topic_id="t1")
        tv1b = _topic_version_id(c, pid, topic_id="t1")  # second version of t1
        tv2 = _topic_version_id(c, pid, topic_id="t2")  # a sibling topic's version

        # approve the second t1 version only
        ap = c.post(
            f"/api/v1/trust/topic-versions/{tv1b}/approvals",
            json={"approved_at": "2026-08-08T00:00:00Z", "expert_name": "Dr X"},
        )
        assert ap.status_code == 200, ap.text

        r = c.get(f"/api/v1/trust/projects/{pid}/topics/t1/versions")
        assert r.status_code == 200, r.text
        body = r.json()
        assert [v["id"] for v in body] == [tv1, tv1b]  # ordered by version_no, t2 excluded
        by_id = {v["id"]: v for v in body}
        assert by_id[tv1]["version_no"] == 1
        assert by_id[tv1]["is_validated"] is False
        assert by_id[tv1b]["version_no"] == 2
        assert by_id[tv1b]["is_validated"] is True
        assert all("created_at" in v for v in body)
        assert tv2 not in by_id

        # a stranger is 403
        _as(f"x-{uuid.uuid4()}", f"x-{uuid.uuid4()}@x.z")
        assert c.get(f"/api/v1/trust/projects/{pid}/topics/t1/versions").status_code == 403


def test_topic_feedback_records_revision_note_and_appears_in_version_detail():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        expert_email = f"e-{uuid.uuid4()}@x.z"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)
        # empty body -> 422
        assert (
            c.post(f"/api/v1/trust/topic-versions/{tvid}/feedback", json={"body": "  "}).status_code
            == 422
        )
        # owner note -> operator
        of = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/feedback", json={"body": "tighten the intro"}
        ).json()
        assert of["author_kind"] == "operator"
        assert of["topic_version_id"] == tvid
        # reviewer note -> expert
        c.post(f"/api/v1/trust/projects/{pid}/invitations", json={"email": expert_email})
        _as(f"e-{uuid.uuid4()}", expert_email)
        c.post("/api/v1/trust/session/sync")
        rf = c.post(
            f"/api/v1/trust/topic-versions/{tvid}/feedback", json={"body": "add a source"}
        ).json()
        assert rf["author_kind"] == "expert" and rf["author_name"] == expert_email
        # both notes surface on the topic-version detail, in order
        detail = c.get(f"/api/v1/trust/topic-versions/{tvid}").json()
        assert [f["body"] for f in detail["feedback"]] == ["tighten the intro", "add a source"]


def test_topic_feedback_unknown_topic_version_404():
    with TestClient(app) as c:
        _as(f"u-{uuid.uuid4()}", f"u-{uuid.uuid4()}@x.z")
        r = c.post(f"/api/v1/trust/topic-versions/{uuid.uuid4()}/feedback", json={"body": "hi"})
        assert r.status_code == 404


def test_topic_feedback_non_member_403():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid, _iid = _project_with_toc_topic(c)
        tvid = _topic_version_id(c, pid)
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        r = c.post(f"/api/v1/trust/topic-versions/{tvid}/feedback", json={"body": "hi"})
        assert r.status_code == 403
