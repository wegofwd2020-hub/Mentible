"""published_artifact — the Open Library registry (ADR-027 / ADR-021 D8)

One row per (book_id, format): a published EPUB/PDF a reader can see and download.
The bytes live on disk (settings.artifact_store_dir); this row is the durable
metadata + pointer. `content_hash` ties the artifact to a book content version so
a stale publish is detectable. Not tied to `account` (books are device-local; the
publisher is recorded as an IdP sub for audit, not a foreign key).

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-04
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE published_artifact (
            book_id          text NOT NULL,
            format           text NOT NULL,
            content_hash     text NOT NULL,
            size_bytes       bigint NOT NULL,
            filename         text NOT NULL,
            storage_path     text NOT NULL,
            published_by_sub text,
            published_at     timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (book_id, format)
        )
        """
    )
    # First-publisher ownership: whoever publishes a book_id first claims it, and
    # only that principal may (re)publish it thereafter. Prevents one registered
    # user from overwriting another author's published artifact (IDOR).
    op.execute(
        """
        CREATE TABLE published_book_owner (
            book_id    text PRIMARY KEY,
            owner_sub  text NOT NULL,
            claimed_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS published_book_owner")
    op.execute("DROP TABLE IF EXISTS published_artifact")
