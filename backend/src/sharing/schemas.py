from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, field_validator


class ShareIn(BaseModel):
    title: str
    version: str
    book_json: dict


class InviteIn(BaseModel):
    email: str

    @field_validator("email")
    @classmethod
    def _email_shape(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1] or len(v) < 5:
            raise ValueError("invalid email")
        return v


class CommentIn(BaseModel):
    version: str
    body: str

    @field_validator("body")
    @classmethod
    def _nonempty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("empty comment")
        return v


class ResponseIn(BaseModel):
    response: str  # empty/whitespace clears


class CommentOut(BaseModel):
    id: int
    version: str
    author_sub: str
    author_email: str | None
    body: str
    author_response: str | None
    responded_at: datetime | None
    created_at: datetime


class DraftOut(BaseModel):
    book_id: str
    title: str
    version: str
    book_json: dict
    access: str


class SharedItem(BaseModel):
    book_id: str
    title: str
    owner_sub: str
    version: str
    updated_at: datetime


class InvitationOut(BaseModel):
    invited_email: str
    invited_by_sub: str
    created_at: datetime
    revoked_at: datetime | None


class OwnedReviewOut(BaseModel):
    book_id: str
    title: str
    version: str
    comment_count: int
    last_comment_at: datetime | None
