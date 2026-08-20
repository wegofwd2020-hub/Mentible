"""sync_keyset + synced_book — zero-knowledge library sync, increment 1.

The server stores CIPHERTEXT ONLY: a per-account wrapped local-master-key
envelope (`sync_keyset`) and per-book encrypted blobs (`synced_book`). Every
column here is either opaque bytes (ciphertext / nonce / wrapped key) or
sync bookkeeping (client_version, deleted, updated_at) — never plaintext
content. App-level isolation via `owner_account_id` (CLAUDE.md rule 4, no
RLS). Chains from 0023 (project rights attestation).
"""

from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE sync_keyset (
            owner_account_id  uuid PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
            wrapped_lmk       bytea NOT NULL,
            lmk_nonce         bytea NOT NULL,
            kek_salt          bytea NOT NULL,
            created_at        timestamptz DEFAULT now()
        )
        """
    )
    op.execute(
        """
        CREATE TABLE synced_book (
            owner_account_id  uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            book_id           text NOT NULL,
            ciphertext        bytea NOT NULL,
            nonce             bytea NOT NULL,
            wrapped_dk        bytea NOT NULL,
            dk_nonce          bytea NOT NULL,
            client_version    text NOT NULL,
            deleted           bool NOT NULL DEFAULT false,
            updated_at        timestamptz DEFAULT now(),
            PRIMARY KEY (owner_account_id, book_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS synced_book")
    op.execute("DROP TABLE IF EXISTS sync_keyset")
