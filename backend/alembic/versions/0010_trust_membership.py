"""trust expert-login: membership, invitation, approval provenance (ADR-037 c)"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE project_membership (
            project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            role        text NOT NULL CHECK (role IN ('owner','reviewer')),
            created_at  timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (project_id, account_id)
        )
        """
    )
    op.execute("CREATE INDEX project_membership_account_idx ON project_membership (account_id)")
    op.execute(
        """
        CREATE TABLE project_invitation (
            id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id      uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            invited_email   text NOT NULL,
            role            text NOT NULL DEFAULT 'reviewer' CHECK (role IN ('reviewer')),
            invited_by_sub  text NOT NULL,
            created_at      timestamptz NOT NULL DEFAULT now(),
            revoked_at      timestamptz,
            UNIQUE (project_id, invited_email)
        )
        """
    )
    op.execute(
        "CREATE INDEX project_invitation_email_idx ON project_invitation (invited_email) "
        "WHERE revoked_at IS NULL"
    )
    op.execute(
        "ALTER TABLE approval ADD COLUMN recorded_via text NOT NULL DEFAULT 'operator' "
        "CHECK (recorded_via IN ('operator','expert_self'))"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE approval DROP COLUMN recorded_via")
    op.execute("DROP TABLE IF EXISTS project_invitation")
    op.execute("DROP TABLE IF EXISTS project_membership")
