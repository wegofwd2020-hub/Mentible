"""synced_epub + synced_shelves — zero-knowledge library sync, increment 2.

The server stores CIPHERTEXT ONLY: per-epub encrypted blobs (`synced_epub`,
including the `meta_ciphertext` sidecar — title/cover/etc — as a *separate*
opaque field from the epub bytes) and a per-account encrypted shelves blob
(`synced_shelves`). Every column here is either opaque bytes (ciphertext /
nonce / wrapped key) or sync bookkeeping (client_version, byte_size, deleted,
updated_at) — never plaintext content. App-level isolation via
`owner_account_id` (CLAUDE.md rule 4, no RLS). Chains from 0024 (sync keyset
+ book).
"""

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE synced_epub (
            owner_account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            epub_id           text NOT NULL,
            ciphertext        bytea,
            nonce             bytea,
            meta_ciphertext   bytea,
            meta_nonce        bytea,
            wrapped_dk        bytea,
            dk_nonce          bytea,
            client_version    text,
            byte_size         bigint NOT NULL DEFAULT 0,
            deleted           bool NOT NULL DEFAULT false,
            updated_at        timestamptz DEFAULT now(),
            PRIMARY KEY (owner_account_id, epub_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE synced_shelves (
            owner_account_id  uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
            ciphertext        bytea,
            nonce             bytea,
            wrapped_dk        bytea,
            dk_nonce          bytea,
            client_version    text,
            updated_at        timestamptz DEFAULT now()
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS synced_shelves")
    op.execute("DROP TABLE IF EXISTS synced_epub")
