from fastapi.testclient import TestClient

from backend.main import app
from backend.src.auth.deps import require_user
from backend.src.auth.principal import Principal


def _as(is_admin: bool):
    app.dependency_overrides[require_user] = lambda: Principal(
        sub="u1", email="u@x.z", issuer="test", is_super_admin=is_admin
    )


def test_non_admin_forbidden_on_feedback_admin():
    with TestClient(app) as c:
        _as(False)
        assert c.get("/api/v1/admin/feedback").status_code == 403
    app.dependency_overrides.clear()
