import asyncio
import os
import uuid

import asyncpg
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
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


def _toc(units):
    """units: list of (topic_id, source_ids)."""
    return {
        "subjects": [
            {
                "subject_label": "S",
                "units": [
                    {
                        "id": uid,
                        "title": uid,
                        "subtopics": [],
                        "prerequisites": [],
                        "source_ids": sids,
                    }
                    for uid, sids in units
                ],
            }
        ]
    }


def _seed_topic_version(pid, topic_id, iid, owner):
    async def _run():
        conn = await asyncpg.connect(DSN)
        try:
            await topic_repo.create_topic_version(
                conn,
                project_id=uuid.UUID(pid),
                topic_id=topic_id,
                title=topic_id,
                source_ids=[iid] if iid else [],
                content={"sections": []},
                created_by_sub=owner,
            )
        finally:
            await conn.close()

    asyncio.run(_run())


def test_generate_book_estimate_counts_missing_and_costs():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        iid = c.post(
            f"/api/v1/trust/projects/{pid}/inputs",
            json={"kind": "note", "content": "word " * 100},
        ).json()["id"]

        toc = _toc([("u1", [iid]), ("u2", [iid]), ("u3", [])])
        assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200

        # u1 already has a topic_version — only u2/u3 are "missing"
        _seed_topic_version(pid, "u1", iid, owner)

        r = c.get(f"/api/v1/trust/projects/{pid}/generate-book/estimate")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["missing_topics"] == 2
        assert body["est_output_tokens_max"] == 2 * 16384
        assert body["est_cost_micros_max"] > 0
        # no managed grant for this caller (BYOK/none) ⇒ no headroom to report
        assert body["remaining_micros"] is None
        assert body["would_exceed"] is False

        # a reviewer/non-member is refused (need_owner=True, matching the generate gate)
        _as(f"s-{uuid.uuid4()}", f"s-{uuid.uuid4()}@x.z")
        assert c.get(f"/api/v1/trust/projects/{pid}/generate-book/estimate").status_code == 403


def test_generate_book_estimate_all_topics_missing_when_none_generated():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "P", "topic": "t"}).json()["id"]
        toc = _toc([("u1", []), ("u2", []), ("u3", [])])
        assert c.put(f"/api/v1/trust/projects/{pid}/toc", json={"toc": toc}).status_code == 200

        r = c.get(f"/api/v1/trust/projects/{pid}/generate-book/estimate")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["missing_topics"] == 3
        assert body["est_output_tokens_max"] == 3 * 16384
