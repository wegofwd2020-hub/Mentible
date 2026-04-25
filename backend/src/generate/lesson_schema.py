"""Pydantic schema for the self-learner lesson output.

The Anthropic response is parsed and validated against this schema before being
written to Redis as the job result. A validation failure surfaces as
`status="failed"` with a generic error message — never echo the raw response
because it may contain something we don't want logged.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class LessonSection(BaseModel):
    heading: str = Field(min_length=1, max_length=200)
    body_markdown: str = Field(min_length=1, max_length=20000)


class LessonOutput(BaseModel):
    """Schema for the JSON returned by Claude for a /generate lesson request."""

    topic: str
    level: str
    language: str

    synopsis: str = Field(min_length=1, max_length=2000)
    learning_objectives: list[str] = Field(min_length=1, max_length=10)
    sections: list[LessonSection] = Field(min_length=1, max_length=15)
    key_takeaways: list[str] = Field(min_length=1, max_length=10)
    further_reading: list[str] = Field(default_factory=list, max_length=10)
