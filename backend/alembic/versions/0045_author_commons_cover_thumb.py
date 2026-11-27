"""Author Commons catalog: store the small raster cover thumbnail.

Authored books carry their artwork as `metadata.coverImage` (full size, for the
EPUB/PDF cover page) and `metadata.coverThumb` (~360px JPEG, for the shelf). The
catalog previously only kept `cover_svg`, which authored books never set, so the
listing fell back to the generated default cover. `cover_thumb` holds the thumbnail
as a `data:image/jpeg;base64,` URI. Nullable: rows published before this migration
keep the SVG/default cover until the author publishes again.

Revision ID: 0045
Revises: 0044
"""

from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE author_commons_entry "
        "ADD COLUMN cover_thumb text CHECK (char_length(cover_thumb) <= 200000)"
    )


def downgrade() -> None:
    op.execute("ALTER TABLE author_commons_entry DROP COLUMN IF EXISTS cover_thumb")
