from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field


class FeedbackType(StrEnum):
    bug = "bug"
    feature = "feature"
    content_quality = "content_quality"
    pricing = "pricing"
    other = "other"


class ContactPreference(StrEnum):
    email_follow_up = "email_follow_up"
    feedback_only = "feedback_only"
    schedule_call = "schedule_call"


class FeedbackIn(BaseModel):
    """A feedback submission. The submitter's EMAIL is NOT taken from here — the
    server uses the authenticated principal's verified email. `app` and
    `created_at` are server-set too."""

    name: str = Field(min_length=1, max_length=255)
    company: str | None = Field(default=None, max_length=255)
    role: str | None = Field(default=None, max_length=255)
    type: FeedbackType
    text: str = Field(min_length=1, max_length=2048)
    contact_preference: ContactPreference
    page: str = Field(min_length=1, max_length=500)


class FeedbackOut(BaseModel):
    id: str
    created_at: str | None


class FeedbackAdminRow(BaseModel):
    """A feedback row for admin list view."""

    id: str
    name: str
    email: str
    app: str
    page: str
    type: str | None
    contact_preference: str | None
    company: str | None
    role: str | None
    snippet: str
    created_at: str


class FeedbackAdminDetail(FeedbackAdminRow):
    """Full feedback details for admin view. Inherits all FeedbackAdminRow fields."""

    text: str
    payload: dict


class FeedbackAdminList(BaseModel):
    """Paginated list of feedback for admin view."""

    rows: list[FeedbackAdminRow]
    next_cursor: str | None = None
