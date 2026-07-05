"""draft sharing: shared_draft + draft_invitation + draft_comment (ADR-027 D2-D4)"""

import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shared_draft",
        sa.Column("book_id", sa.Text(), primary_key=True),
        sa.Column("owner_sub", sa.Text(), nullable=False),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("book_json", JSONB(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_table(
        "draft_invitation",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "book_id",
            sa.Text(),
            sa.ForeignKey("shared_draft.book_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("invited_email", sa.Text(), nullable=False),
        sa.Column("invited_by_sub", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("revoked_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.UniqueConstraint("book_id", "invited_email", name="uq_draft_invitation_book_email"),
    )
    op.create_table(
        "draft_comment",
        sa.Column("id", sa.BigInteger(), sa.Identity(), primary_key=True),
        sa.Column(
            "book_id",
            sa.Text(),
            sa.ForeignKey("shared_draft.book_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("version", sa.Text(), nullable=False),
        sa.Column("author_sub", sa.Text(), nullable=False),
        sa.Column("author_email", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("author_response", sa.Text(), nullable=True),
        sa.Column("responded_at", sa.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.TIMESTAMP(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_draft_comment_book_version", "draft_comment", ["book_id", "version", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_draft_comment_book_version", table_name="draft_comment")
    op.drop_table("draft_comment")
    op.drop_table("draft_invitation")
    op.drop_table("shared_draft")
