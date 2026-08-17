import os
import uuid

import fakeredis.aioredis
import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.src.accounts.deps import require_active_user
from backend.src.auth.principal import Principal
from backend.src.core.redis_dep import get_redis

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


@pytest.fixture(autouse=True)
def _redis():
    fake = fakeredis.aioredis.FakeRedis(decode_responses=False)
    app.dependency_overrides[get_redis] = lambda: fake
    yield fake


def test_get_version_includes_quality_coverage_and_readability():
    with TestClient(app) as c:
        owner = f"o-{uuid.uuid4()}"
        _as(owner, f"{owner}@x.z")
        pid = c.post("/api/v1/trust/projects", json={"title": "Guide", "topic": "t"}).json()["id"]
        inp = c.post(
            f"/api/v1/trust/projects/{pid}/inputs",
            json={"kind": "note", "title": "Src", "content": "some source content"},
        ).json()
        art = c.post(
            f"/api/v1/trust/projects/{pid}/artifacts",
            json={"role": "cornerstone", "format": "book"},
        ).json()
        content = {
            "sections": [
                {
                    "heading": "A",
                    "body": "The cat sat on the mat. The dog ran fast.",
                    "source_ids": [inp["id"]],
                }
            ]
        }
        ver = c.post(
            f"/api/v1/trust/artifacts/{art['id']}/versions", json={"content": content}
        ).json()
        vid = ver["id"]

        r = c.get(f"/api/v1/trust/versions/{vid}")
        assert r.status_code == 200
        body = r.json()
        assert body["quality"]["coverage"]["sections_total"] == 1
        assert body["quality"]["coverage"]["sections_cited"] == 1
        assert "readability" in body["quality"]
        assert body["quality"]["grounding"] is None
