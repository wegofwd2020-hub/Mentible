"""Author Commons catalog: one row per published book listed in the commons.

Metadata only (no book content). `status` is `live` or `hidden`; the author hides or
republishes. `cover_svg` holds the book's inline cover (stored as the data URI the
catalog serves).

Revision ID: 0044
Revises: 0043
"""

from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE author_commons_entry (
            book_id      text PRIMARY KEY,
            owner_sub    text NOT NULL,
            title        text NOT NULL,
            author_name  text NOT NULL,
            account_name text NOT NULL,
            version      integer NOT NULL DEFAULT 1,
            published_at timestamptz NOT NULL DEFAULT now(),
            cover_svg    text,
            description  text,
            language     text,
            formats      text[] NOT NULL DEFAULT '{}',
            status       text NOT NULL DEFAULT 'live'
                CHECK (status IN ('live', 'hidden')),
            updated_at   timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        "CREATE INDEX author_commons_entry_live_idx "
        "ON author_commons_entry (published_at DESC) WHERE status = 'live'"
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS author_commons_entry")
