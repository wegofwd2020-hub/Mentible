"""Freeze the charged topic set on a whole-book generation job.

The Free cap charges a book one generation per topic (ADR-043). The worker used to
recompute its topic list from the live TOC at run time, so a TOC edited after submit
could make it generate topics that were never charged. `planned_topic_ids` stores the
exact topic ids the submit charged; the worker generates only those.

NULL = a job created before this migration. The worker keeps the old recompute for
those, so in-flight jobs at deploy behave as they did before.

Revision ID: 0041
Revises: 0040
"""

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE generation_job ADD COLUMN planned_topic_ids text[]")


def downgrade() -> None:
    op.execute("ALTER TABLE generation_job DROP COLUMN IF EXISTS planned_topic_ids")
