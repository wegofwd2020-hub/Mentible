"""Prompt construction for source-grounded chapter-quiz requests.

Unlike `prompt_builder.build_lesson_prompt` (which asks the model to teach a
topic from its own knowledge), this asks the model to write a reading-
comprehension quiz answerable ONLY from a supplied passage — the "why import"
payoff for Open Shelves (F2): a chapter from a book the user imported, quizzed
against its own text, never outside knowledge.

Output JSON schema is validated by `quiz_schema.QuizOutput`. Keep the field
set there in sync with the schema example below.
"""

from __future__ import annotations

# Default quiz size (Open Shelves F2 plan, Global Constraints: "Quiz size
# default: 5 questions per chapter").
DEFAULT_N_QUESTIONS = 5


def build_quiz_prompt(source_text: str, n_questions: int = DEFAULT_N_QUESTIONS) -> str:
    """Return the prompt for generating a source-grounded multiple-choice quiz.

    Output is JSON conforming to `quiz_schema.QuizOutput`.

    The passage is the ONLY source of truth: the model must not draw on
    outside knowledge, and every `explanation` must point back at the
    supporting sentence in the passage (so a reader can verify the answer
    without leaving the chapter).
    """
    return f"""You are writing a reading-comprehension quiz for a reader who has just \
finished reading the passage below.

Using ONLY the passage below, write {n_questions} multiple-choice questions that a \
reader could answer directly from the passage. Do NOT use outside knowledge, and do \
NOT ask about anything that is not stated or clearly implied in the passage — every \
question must be answerable from the passage alone.

For each question:
- Provide exactly 4 options, labelled with `option_id` "A", "B", "C", "D".
- Exactly one option is correct; set `correct_option` to its `option_id`.
- Write an `explanation` that quotes or closely paraphrases the sentence in the \
passage that supports the correct answer, so the reader can verify it against the text.
- Set `difficulty` to "easy", "medium", or "hard" based on how directly the passage \
states the answer.
- Vary what each question tests (facts, sequence, cause/effect, character/detail) \
rather than repeating the same angle.

You MUST respond with ONLY valid JSON — no markdown fences, no extra text, no \
explanation outside the JSON. The JSON must exactly match this schema:

{{
  "set_number": 1,
  "questions": [
    {{
      "question_id": "q1",
      "question_text": "<question, referring only to the passage>",
      "question_type": "multiple_choice",
      "options": [
        {{"option_id": "A", "text": "<option>"}},
        {{"option_id": "B", "text": "<option>"}},
        {{"option_id": "C", "text": "<option>"}},
        {{"option_id": "D", "text": "<option>"}}
      ],
      "correct_option": "A",
      "explanation": "<why this is correct, citing the passage>",
      "difficulty": "easy"
    }}
  ],
  "total_questions": {n_questions},
  "passing_score": {max(1, n_questions // 2)},
  "estimated_duration_minutes": {max(1, n_questions)}
}}

Requirements:
- questions: exactly {n_questions} items, each with a unique "question_id" (q1, q2, ...).
- Do NOT include any text outside the JSON object.

PASSAGE (this is the ONLY source of truth — use nothing else):
<<<
{source_text}
>>>
"""
