"""Pydantic schema for the source-grounded chapter-quiz output.

Mirrors the mobile `QuizSet`/`QuizQuestion`/`QuizOption` types
(`mobile/src/types/book.ts:91-112`) FIELD-FOR-FIELD so the app renders the
result with no mapping layer. Do not rename fields here without updating the
mobile types (and vice versa) — they are one contract in two languages.

The Anthropic response is parsed and validated against this schema before
being written to Redis as the job result, same discipline as `lesson_schema`.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, model_validator


class QuizOptionOut(BaseModel):
    """Mirrors mobile `QuizOption` — NOTE the field is `text`, not `option_text`."""

    option_id: str = Field(min_length=1, max_length=4)  # "A".."D"
    text: str = Field(min_length=1, max_length=500)


class QuizQuestionOut(BaseModel):
    """Mirrors mobile `QuizQuestion` — `correct_option` lives on the QUESTION,
    not as a per-option `is_correct` flag."""

    question_id: str = Field(min_length=1, max_length=100)
    question_text: str = Field(min_length=1, max_length=2000)
    question_type: str = Field(min_length=1, max_length=50)  # "multiple_choice"
    options: list[QuizOptionOut] = Field(min_length=2, max_length=6)
    correct_option: str = Field(min_length=1, max_length=4)  # "A".."D"
    explanation: str = Field(min_length=1, max_length=2000)
    difficulty: str = Field(min_length=1, max_length=20)  # "easy"|"medium"|"hard"

    @model_validator(mode="after")
    def _correct_option_exists(self) -> QuizQuestionOut:
        """Grounding sanity check: `correct_option` must reference one of the
        question's own options — a model that answers "E" when there is no E
        is a validation failure worth repairing, not a silently-broken quiz."""
        option_ids = {opt.option_id for opt in self.options}
        if self.correct_option not in option_ids:
            raise ValueError(
                f"correct_option {self.correct_option!r} is not among this "
                f"question's option_ids {sorted(option_ids)!r}"
            )
        return self


class QuizOutput(BaseModel):
    """Schema for the JSON returned by Claude for a /generate quiz request.

    == mobile `QuizSet`. No `set_title` field (the plan's earlier guess was
    wrong — see the mobile type).
    """

    set_number: int | None = None
    questions: list[QuizQuestionOut] = Field(min_length=1, max_length=10)
    total_questions: int | None = None
    passing_score: int | None = None
    estimated_duration_minutes: int | None = None
