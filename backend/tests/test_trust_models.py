# backend/tests/test_trust_models.py
from src.trust import models


def test_enum_tuples():
    assert models.PROJECT_STATUSES == ("active", "archived")
    assert models.INPUT_KINDS == ("transcript", "note", "upload", "link")
    assert models.ARTIFACT_ROLES == ("cornerstone", "derivative")
    assert "book" in models.ARTIFACT_FORMATS and "x_thread" in models.ARTIFACT_FORMATS
    assert models.FEEDBACK_AUTHOR_KINDS == ("expert", "operator")


def test_dataclasses_frozen():
    import dataclasses

    p = models.Project(
        id="00000000-0000-0000-0000-000000000000",
        owner_account_id="00000000-0000-0000-0000-000000000001",
        title="T",
        topic=None,
        audience=None,
        goal=None,
        status="active",
        created_at=None,
        updated_at=None,
    )
    assert p.title == "T"
    with_ = dataclasses.replace  # frozen: mutation must go through replace
    assert with_(p, title="U").title == "U"
