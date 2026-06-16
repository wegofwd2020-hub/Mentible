"""account + per-provider credential set (ADR-014 D2/D8)

The first Mentible DB. `account` keys on the IdP `sub` and holds no generation
data (D8). `provider_credential` is the registry-keyed credential set as ROWS
(adding a provider needs no migration, D2) and stores only custody/status
metadata — never key material (D5). Credentials cascade-delete with the account
(supports the D8 purge).

Revision ID: 0001
Revises:
Create Date: 2026-06-16
"""

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE account (
            id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            idp_sub             text NOT NULL UNIQUE,
            email               text,
            created_at          timestamptz NOT NULL DEFAULT now(),
            synced_library_ref  text
        )
        """
    )
    op.execute(
        """
        CREATE TABLE provider_credential (
            account_id        uuid NOT NULL REFERENCES account(id) ON DELETE CASCADE,
            provider_id       text NOT NULL,
            source            text NOT NULL
                CHECK (source IN ('device_local', 'synced_e2e', 'managed_vault')),
            status            text NOT NULL DEFAULT 'unverified'
                CHECK (status IN ('valid', 'rejected', 'unverified')),
            last_verified_at  timestamptz,
            updated_at        timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (account_id, provider_id)
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS provider_credential")
    op.execute("DROP TABLE IF EXISTS account")
