"""Managed-key vault access — the wegofwd-billing MECHANISM seam.

ADR-019 amendment (2026-06-30) / ADR-005 D6 / `docs/MANAGED_BILLING_BUILD_PLAN.md`
(Phase 1). Holds OUR company provider keys — a small fixed set, one per managed
provider, NOT per-user — and hands the right one to the worker for a managed
generation. This is the "identical everywhere" mechanism earmarked for extraction
into `wegofwd-billing` when a second consumer (likely Pramana) wires to it; the
*policy* of who-may-use-managed lives in `eligibility.py` (per-app), never here.

**Discipline (ADR-001 / ADR-005 D3):** the managed key is OUR secret and is treated
exactly like a BYOK key — it travels from settings to the provider call and is NEVER
passed to a log line, DB row, or traceback. Storage is option A (env/secret via
`settings`), so adding a managed provider is a config + one-line change here.
"""

from __future__ import annotations

from backend.config import settings


def _managed_keys() -> dict[str, str]:
    """`provider_id` → OUR key, for the providers we offer managed today.

    A provider is offered managed only once its ToS clears for serving end users on our
    account (ADR-005 O4 — all four cleared) AND its key is configured here; an unset key
    means the provider is simply absent ⇒ not offered managed. (Phase 6 generalised this
    from Anthropic-only.) ⚠ Gemini must be a PAID key (free tier trains on data, O4).
    """
    candidates = (
        ("anthropic", settings.managed_anthropic_api_key),
        ("openai", settings.managed_openai_api_key),
        ("groq", settings.managed_groq_api_key),
        ("gemini", settings.managed_gemini_api_key),
    )
    return {pid: key for pid, key in candidates if key}


def get_managed_key(provider_id: str) -> str | None:
    """OUR managed key for `provider_id`, or None if that provider isn't offered
    managed (or no key is configured).

    NEVER pass the return value to a log call — it is a live provider credential.
    """
    return _managed_keys().get(provider_id)


def managed_provider_ids() -> frozenset[str]:
    """The providers currently offered on the managed path (i.e. with a configured key)."""
    return frozenset(_managed_keys())
