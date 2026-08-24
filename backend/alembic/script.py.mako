"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, Sequence[str], None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}


def upgrade() -> None:
    """Upgrade schema."""
    # RLS: any new public table MUST have Row-Level Security enabled (Supabase exposes
    # public tables via PostgREST + the public anon key). env.py enables RLS on all
    # public tables after every migration automatically, so you normally need do
    # nothing — but you MAY be explicit for a new table:
    #     op.execute('alter table public.<new_table> enable row level security;')
    # NEVER add a permissive `using(true)` policy or `force row level security`.
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Downgrade schema."""
    ${downgrades if downgrades else "pass"}
