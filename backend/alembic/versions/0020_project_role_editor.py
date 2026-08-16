"""project_membership/project_invitation.role — add 'editor' (P0-2 slice C)

Widens both CHECK constraints so a project can carry a third role alongside
owner/reviewer: editor (create/edit content, no approve). See
`backend/src/trust/access.py` PROJECT_ROLES and `models.py` INVITE_ROLES.
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

_MEMBERSHIP_CONSTRAINT = "project_membership_role_check"
_INVITATION_CONSTRAINT = "project_invitation_role_check"


def upgrade() -> None:
    op.execute(f"ALTER TABLE project_membership DROP CONSTRAINT {_MEMBERSHIP_CONSTRAINT}")
    op.execute(
        "ALTER TABLE project_membership ADD CONSTRAINT "
        f"{_MEMBERSHIP_CONSTRAINT} CHECK (role IN ('owner','reviewer','editor'))"
    )
    op.execute(f"ALTER TABLE project_invitation DROP CONSTRAINT {_INVITATION_CONSTRAINT}")
    op.execute(
        "ALTER TABLE project_invitation ADD CONSTRAINT "
        f"{_INVITATION_CONSTRAINT} CHECK (role IN ('reviewer','editor'))"
    )


def downgrade() -> None:
    op.execute(f"ALTER TABLE project_invitation DROP CONSTRAINT {_INVITATION_CONSTRAINT}")
    op.execute(
        "ALTER TABLE project_invitation ADD CONSTRAINT "
        f"{_INVITATION_CONSTRAINT} CHECK (role IN ('reviewer'))"
    )
    op.execute(f"ALTER TABLE project_membership DROP CONSTRAINT {_MEMBERSHIP_CONSTRAINT}")
    op.execute(
        "ALTER TABLE project_membership ADD CONSTRAINT "
        f"{_MEMBERSHIP_CONSTRAINT} CHECK (role IN ('owner','reviewer'))"
    )
