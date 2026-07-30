"""trust/validation data model (ADR-037 sub-project b)"""

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE project (
            id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            owner_account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            title             text NOT NULL,
            topic             text,
            audience          text,
            goal              text,
            status            text NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','archived')),
            created_at        timestamptz NOT NULL DEFAULT now(),
            updated_at        timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX project_owner_idx ON project (owner_account_id)
        """
    )
    op.execute(
        """
        CREATE TABLE project_input (
            id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id    uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            kind          text NOT NULL
                          CHECK (kind IN ('transcript','note','upload','link')),
            title         text,
            content       text,
            source_ref    text,
            storage_path  text,
            content_hash  text,
            created_at    timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX project_input_project_idx ON project_input (project_id)
        """
    )
    op.execute(
        """
        CREATE TABLE artifact (
            id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            project_id  uuid NOT NULL REFERENCES project(id) ON DELETE CASCADE,
            role        text NOT NULL CHECK (role IN ('cornerstone','derivative')),
            format      text NOT NULL CHECK (format IN
                        ('book','guide','learning_module','podcast',
                         'youtube','reel','linkedin','x_thread')),
            title       text,
            created_at  timestamptz NOT NULL DEFAULT now(),
            updated_at  timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX artifact_project_idx ON artifact (project_id)
        """
    )
    op.execute(
        """
        CREATE TABLE artifact_version (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            artifact_id      uuid NOT NULL REFERENCES artifact(id) ON DELETE CASCADE,
            version_no       integer NOT NULL,
            content          jsonb NOT NULL,
            generation_meta  jsonb,
            created_by_sub   text NOT NULL,
            created_at       timestamptz NOT NULL DEFAULT now(),
            UNIQUE (artifact_id, version_no)
        )
        """
    )
    op.execute(
        """
        CREATE INDEX artifact_version_artifact_idx ON artifact_version (artifact_id)
        """
    )
    op.execute(
        """
        CREATE TABLE artifact_version_source (
            version_id  uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE,
            input_id    uuid NOT NULL REFERENCES project_input(id) ON DELETE CASCADE,
            PRIMARY KEY (version_id, input_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE feedback (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            version_id       uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE,
            author_kind      text NOT NULL CHECK (author_kind IN ('expert','operator')),
            author_name      text,
            body             text NOT NULL,
            recorded_by_sub  text NOT NULL,
            created_at       timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE INDEX feedback_version_idx ON feedback (version_id)
        """
    )
    op.execute(
        """
        CREATE TABLE approval (
            id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            version_id       uuid NOT NULL REFERENCES artifact_version(id) ON DELETE CASCADE,
            expert_name      text NOT NULL,
            expert_email     text,
            expert_role      text,
            approved_at      timestamptz NOT NULL,
            recorded_by_sub  text NOT NULL,
            recorded_at      timestamptz NOT NULL DEFAULT now(),
            note             text
        )
        """
    )
    op.execute(
        """
        CREATE INDEX approval_version_idx ON approval (version_id)
        """
    )


def downgrade() -> None:
    op.execute(
        """
        DROP TABLE IF EXISTS approval;
        DROP TABLE IF EXISTS feedback;
        DROP TABLE IF EXISTS artifact_version_source;
        DROP TABLE IF EXISTS artifact_version;
        DROP TABLE IF EXISTS artifact;
        DROP TABLE IF EXISTS project_input;
        DROP TABLE IF EXISTS project;
        """
    )
