"""CORS preflight must allow every HTTP method the API actually exposes.

Regression guard: Slice A added `PATCH /trust/inputs/{id}` but PATCH was missing
from the CORS `allow_methods` list, so browser preflight (OPTIONS) returned 400
and the source-edit save never reached the backend. TestClient/RNTL don't do a
real CORS preflight, so nothing caught it — hence this explicit test.
"""

from fastapi.testclient import TestClient

from backend.main import app


def _preflight(c, method: str):
    return c.options(
        "/api/v1/trust/inputs/00000000-0000-0000-0000-000000000000",
        headers={
            "Origin": "http://localhost:8081",
            "Access-Control-Request-Method": method,
        },
    )


def test_patch_preflight_is_allowed():
    with TestClient(app) as c:
        r = _preflight(c, "PATCH")
        assert r.status_code == 200, r.text
        assert "PATCH" in r.headers.get("access-control-allow-methods", "")


def test_delete_preflight_is_allowed():
    with TestClient(app) as c:
        r = _preflight(c, "DELETE")
        assert r.status_code == 200
        assert "DELETE" in r.headers.get("access-control-allow-methods", "")
