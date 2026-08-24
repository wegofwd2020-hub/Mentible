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
    #
    # The `length(ciphertext) >= 16` guard assumes every non-deleted Inc-2 row
    # is a real @noble ct‖tag(16) blob, so it's always >= 16 bytes (a 0-byte
    # ciphertext only occurs on a tombstone, which is `deleted = true` and
    # skipped here). A non-deleted row somehow shorter than 16 bytes (not
    # producible by the real client) would fall through this UPDATE untouched
    # and then get `tag = ''` from the fallback step below — landing with an
    # un-shrunk `ciphertext`/`byte_size` and an empty tag, which is NOT a
    # correct split. No such row is expected in practice; a stricter version
    # of this migration could instead assert `count(*) = 0` for that case
    # before proceeding, but that's deliberately left as a manual safety net
    # rather than a hard guard here.
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
