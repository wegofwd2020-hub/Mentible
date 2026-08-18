"""project.rights_attested_at / project.rights_holder — per-project rights
attestation (B3 Part B). DISPLAY-ONLY: never gates or blocks export. Chains
from 0022 (version_originality, B3 Part A)."""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE project ADD COLUMN rights_attested_at TIMESTAMPTZ")
    op.execute("ALTER TABLE project ADD COLUMN rights_holder TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE project DROP COLUMN rights_holder")
    op.execute("ALTER TABLE project DROP COLUMN rights_attested_at")
