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


def test_membership_invite_tuples():
    assert models.MEMBERSHIP_ROLES == ("owner", "reviewer")
    assert models.INVITE_ROLES == ("reviewer",)
    assert models.APPROVAL_VIA == ("operator", "expert_self")


def test_membership_invitation_dataclasses():
    m = models.Membership(project_id="p", account_id="a", role="reviewer", created_at=None)
    assert m.role == "reviewer"
    inv = models.Invitation(
        id="i",
        project_id="p",
        invited_email="x@y.z",
        role="reviewer",
        invited_by_sub="op",
        created_at=None,
        revoked_at=None,
    )
    assert inv.invited_email == "x@y.z" and inv.revoked_at is None
