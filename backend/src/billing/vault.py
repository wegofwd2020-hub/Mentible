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

    Phase 1 is Anthropic-only. Add a provider here ONLY once its ToS clears for
    serving end users on our account (ADR-005 O4). A provider whose key is unset is
    simply absent ⇒ not offered managed.
    """
    keys: dict[str, str] = {}
    if settings.managed_anthropic_api_key:
        keys["anthropic"] = settings.managed_anthropic_api_key
    return keys


def get_managed_key(provider_id: str) -> str | None:
    """OUR managed key for `provider_id`, or None if that provider isn't offered
    managed (or no key is configured).

    NEVER pass the return value to a log call — it is a live provider credential.
    """
    return _managed_keys().get(provider_id)


def managed_provider_ids() -> frozenset[str]:
    """The providers currently offered on the managed path (i.e. with a configured key)."""
    return frozenset(_managed_keys())
