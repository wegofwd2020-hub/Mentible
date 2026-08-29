"""Inline validated generation for a source-cited trust artifact draft (ADR-037 Phase 02).

Mirrors `derivatives/generate.py`'s inline (non-async-job) generation shape: the
router calls this synchronously and returns the result in the same request.
Reuses the same provider seam + conformance loop discipline as
`generate.tasks.run_generation` — build a provider from the registry, issue a
JSON-mode request, and validate + repair via `generate_validated`.
"""

from __future__ import annotations

import json

from pydantic import BaseModel, Field
from wegofwd_llm.conformance import ConformanceResult, generate_validated
from wegofwd_llm.contract import LLMRequest
from wegofwd_llm.errors import LLMRateLimitError, LLMResponseError
from wegofwd_llm.registry import build_provider

from backend.config import settings
from backend.src.generate.anthropic_caller import parse_json_response

from .draft_prompt import build_draft_prompt

# Friendly engine names for user-facing failure copy (kept minimal on purpose — the
# client's provider registry holds the full labels; this is just for error text).
_ENGINE_DISPLAY = {
    "groq": "The free Groq engine",
    "anthropic": "Claude (Anthropic)",
    "openai": "OpenAI",
    "gemini": "Google Gemini",
    "openrouter": "OpenRouter",
}


def token_limit_message(provider_id: str, exc: Exception) -> str | None:
    """An actionable failure message when generation stopped on a TOKEN / rate
    limit — it names the engine and the fix, instead of the generic "generation
    failed". Returns None for any other error (the caller keeps its own message).

    Groq's free tier is the common case: its ~8000 tokens/min covers input +
    output COMBINED, so a large-source topic is rejected 413 (too big) or
    429 rate-limited. Both point the user at switching engines or trimming sources."""
    is_too_large = isinstance(exc, LLMResponseError) and "413" in str(exc)
    is_rate = isinstance(exc, LLMRateLimitError)
    if not (is_too_large or is_rate):
        return None
    engine = _ENGINE_DISPLAY.get(provider_id, provider_id)
    if provider_id == "groq":
        if is_too_large:
            return (
                f"{engine} couldn't fit this request. Its free tier allows about 8,000 "
                "tokens per minute — your sources plus the generated reply combined — and "
                "this is over that. Switch the engine to your own key in Settings → "
                "Engine, or shorten or split the sources."
            )
        return (
            f"{engine} hit its per-minute token limit. Wait about a minute and try again, "
            "or switch to your own key in Settings → Engine for no per-minute limit."
        )
    # A BYOK / paid provider that rate-limited (rarer); a 413 there falls through to
    # the caller's generic message.
    if is_rate:
        return f"{engine} rate-limited the request. Wait a moment and try again."
    return None


# Groq free-tier budgeting knobs. The tokens/minute limit is input+output
# COMBINED, so a large prompt eats into the output we can ask for. Estimate input
# tokens conservatively (fewer chars-per-token ⇒ higher estimate ⇒ safer under the
# 413), keep a margin, and never ask for a uselessly tiny output.
# Conservative: English is ~4 chars/token, but dense scripts (Sanskrit/Tamil
# transliteration, seen in real Vedic-content projects) tokenize at ~2.8. Use 2.5
# so we OVERestimate input for any content ⇒ shrink output enough to clear the 413.
_CHARS_PER_TOKEN = 2.5
_TPM_MARGIN = 512  # headroom for tokens we can't see (chat template, role framing)
_MIN_OUTPUT = 256  # floor; below this a draft can't be produced anyway


def cap_max_tokens(provider_id: str, max_tokens: int, prompt: str | None = None) -> int:
    """Cap the OUTPUT-token request for Groq's free tier so input+output fits its
    tokens-per-minute limit. Two stages, both no-ops for non-Groq providers:

    1. A flat output ceiling (`GROQ_MAX_OUTPUT_TOKENS`, 0 disables) — a 16384-output
       request alone exceeds the ~8000 TPM and is rejected 413.
    2. An input-aware shrink (`GROQ_TPM_LIMIT`, 0 disables) — when `prompt` is given,
       subtract its estimated tokens (+ margin) from the TPM budget so a large-source
       topic (e.g. ~3600 input) doesn't push input+output past the limit. This is why
       a flat cap wasn't enough: 3600 input + 5000 output = 8600 > 8000 → 413.

    Shared by every trust generation path (draft / topic / grounding / originality).
    Raise the two limits on a paid Dev tier (higher TPM) so full-size outputs fit."""
    if provider_id != "groq":
        return max_tokens
    cap = max_tokens
    if settings.groq_max_output_tokens > 0:
        cap = min(cap, settings.groq_max_output_tokens)
    if prompt is not None and settings.groq_tpm_limit > 0:
        est_input = int(len(prompt) / _CHARS_PER_TOKEN) + 1
        budget = settings.groq_tpm_limit - est_input - _TPM_MARGIN
        cap = min(cap, budget)
    return max(_MIN_OUTPUT, cap)


_MAX_REPAIRS = 2
# A whole-book draft is several sections of real prose — 4096 truncated multi-
# section drafts mid-JSON → invalid output → 502 (the same failure the per-topic
# generator hit; see reference_llm_output_shape_gotchas). Match the pipeline's
# book default.
_MAX_TOKENS = 16384


class _DraftSection(BaseModel):
    heading: str
    body: str
    sources: list[str] = []


class _DraftOutput(BaseModel):
    sections: list[_DraftSection] = Field(min_length=1, max_length=6)


def _coerce_draft(obj: object) -> _DraftOutput:
    """Validate the model's output into a _DraftOutput, tolerating a common quirk:
    some models double-encode the array, returning `sections` as a JSON STRING
    instead of a list. Decode it before validating; leave anything else to pydantic."""
    if isinstance(obj, dict) and isinstance(obj.get("sections"), str):
        try:
            obj = {**obj, "sections": json.loads(obj["sections"])}
        except (json.JSONDecodeError, TypeError):
            pass  # not a JSON array string — let pydantic raise the real error
    return _DraftOutput.model_validate(obj)


def generate_draft(
    *, sources, artifact_format, topic, audience, goal, provider_id, api_key, model, guidance=None
) -> ConformanceResult:
    """Generate + validate a whole-book/artifact draft. Returns the full
    `ConformanceResult` (not just `.parsed`) so the caller
    (`trust.tasks._run_version`) can meter the observed token counts
    (`total_input_tokens`/`total_output_tokens`) for managed generations — see
    `_record_trust_usage`. Access the drafted `_DraftOutput` via `.parsed`."""
    prompt = build_draft_prompt(sources, artifact_format, topic, audience, goal, guidance)
    provider = build_provider(provider_id, api_key=api_key, model=model)
    req = LLMRequest(
        prompt=prompt,
        max_tokens=cap_max_tokens(provider_id, _MAX_TOKENS, prompt=prompt),
        response_format="json",
    )

    def _validate(text: str) -> _DraftOutput:
        return _coerce_draft(parse_json_response(text))

    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)


def draft_output_to_sections(out: _DraftOutput, sources) -> tuple[list[dict], list[str]]:
    """Map a `_DraftOutput`'s model-labelled sources (S1..Sn) to real input ids.

    Shared by the sync path and `trust.tasks._run_version` — drop unknown
    labels rather than 500 on a bad one (the model occasionally invents a
    label that doesn't exist)."""
    by_label = {f"S{i + 1}": str(s.id) for i, s in enumerate(sources)}
    sections = [
        {
            "heading": sec.heading,
            "body": sec.body,
            "source_ids": [by_label[label] for label in sec.sources if label in by_label],
        }
        for sec in out.sections
    ]
    cited = sorted({sid for s in sections for sid in s["source_ids"]})
    return sections, cited
