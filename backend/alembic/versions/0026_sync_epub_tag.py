"""synced_epub.tag — split the @noble appended GCM tag into its own column
(Increment 2.1: native file cipher returns tag separately; wire body becomes
ciphertext-only). Backfills existing Inc-2 rows, whose `ciphertext` is
`actual_ciphertext‖tag(16)`.

Revision ID: 0026
Revises: 0025
"""

from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Add nullable, backfill, then set NOT NULL (can't add NOT NULL to a
    #    populated table without a default).
    op.execute("ALTER TABLE synced_epub ADD COLUMN tag bytea")
    # 2) Live rows: last 16 bytes are the GCM tag; the rest is ciphertext.
    #    byte_size (used for the per-user cap) becomes the ciphertext length.
    # Postgres has no bytea `left()`/`right()` overload (those are text-only) —
    # use `substring(bytea FROM .. FOR ..)`, which bytea does support.
    op.execute(
        """
        UPDATE synced_epub
           SET tag        = substring(ciphertext from length(ciphertext) - 16 + 1 for 16),
               ciphertext = substring(ciphertext from 1 for length(ciphertext) - 16),
               byte_size  = length(ciphertext) - 16
         WHERE deleted = false AND length(ciphertext) >= 16
        """
    )
    # 3) Tombstones (and any empty row): empty tag, ciphertext already ''.
    op.execute(r"UPDATE synced_epub SET tag = '\x'::bytea WHERE tag IS NULL")
    op.execute("ALTER TABLE synced_epub ALTER COLUMN tag SET NOT NULL")


def downgrade() -> None:
    # Re-append the tag so a rolled-back Inc-2 client still reads @noble's ct‖tag.
    op.execute(
        "UPDATE synced_epub SET ciphertext = ciphertext || tag, "
        "byte_size = length(ciphertext || tag) WHERE deleted = false"
    )
    op.execute("ALTER TABLE synced_epub DROP COLUMN tag")
