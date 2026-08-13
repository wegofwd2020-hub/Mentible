"""Shared missing-topics + cost-estimate helpers for the whole-book generate fan-out
(ADR-037 book generation; Task 2). Pure functions — no I/O, no DB access — so the
pre-run estimate endpoint and the fan-out task (a later task) share one source of
truth for "which topics still need a version" and "what will this cost."
"""

from __future__ import annotations

from dataclasses import dataclass

from ..billing import pricing

# Per-topic output cap — mirrors generate_topic._MAX_TOKENS (the actual max_tokens
# each per-topic generation call is submitted with).
_MAX_OUTPUT_TOKENS = 16384


@dataclass(frozen=True)
class BookEstimate:
    """A pre-run estimate for generating every still-missing TOC topic."""

    missing_topics: int
    est_input_tokens: int
    est_output_tokens_max: int
    est_cost_micros_max: int


def _iter_units(toc):
    for subj in (toc or {}).get("subjects", []):
        yield from subj.get("units") or []


def missing_topics(project, existing_topic_ids: set[str]) -> list[dict]:
    """TOC units (`{id,title,subtopics,source_ids}`) with no topic_version yet."""
    return [u for u in _iter_units(project.toc) if str(u.get("id")) not in existing_topic_ids]


def estimate(missing, inputs_by_id, provider_id: str, model: str) -> BookEstimate:
    """Worst-case token/cost estimate for generating `missing` topics.

    Input tokens are estimated PER TOPIC from that topic's own scoped
    `source_ids` (not every project input) — chars // 4 as a rough
    chars-per-token approximation, plus a flat per-call prompt overhead.
    Output is the per-topic max_tokens cap, since the actual output length
    isn't known until generation runs — this is a MAX, not an expectation.
    """
    est_input = 0
    for u in missing:
        chars = sum(
            len(inputs_by_id[sid].content or "")
            for sid in (u.get("source_ids") or [])
            if sid in inputs_by_id
        )
        est_input += chars // 4 + 400  # /4 ≈ tokens; +400 prompt overhead
    est_output = len(missing) * _MAX_OUTPUT_TOKENS
    cost = pricing.cost_micros(provider_id, model, est_input, est_output)
    return BookEstimate(len(missing), est_input, est_output, cost)
