"""Managed-eligibility POLICY — per-app (ADR-019: billing policy stays per-app).

Answers "may this verified caller generate on OUR managed key?" Phase 1 is an
**internal staff-managed allowlist** (config CSV, mirroring the ADR-020 super-admin
allowlist) with no plans, entitlements, or caps yet — those replace the allowlist in
`docs/MANAGED_BILLING_BUILD_PLAN.md` phases 3–4. As with super-admin, the allowlist
comes from **config only, never a token claim** (a client cannot assert its own
managed status), and an empty allowlist ⇒ nobody is eligible (safe default: everyone
keeps using BYOK).

This is the *policy* counterpart to `vault.py`'s *mechanism*: the vault travels into
`wegofwd-billing`; this stays in the app (each product decides eligibility its own way).
"""

from __future__ import annotations

from backend.config import settings
from backend.src.auth.principal import Principal
from backend.src.billing.vault import get_managed_key


def _parse_csv(raw: str) -> frozenset[str]:
    """Split a comma-separated config value into a set of trimmed, non-empty items."""
    return frozenset(item.strip() for item in raw.split(",") if item.strip())


# Computed once at import from config (like the ADR-020 admin allowlist). Emails are
# matched case-insensitively; subs are opaque, matched exactly. Tests monkeypatch these
# module-level sets to vary the allowlist.
_MANAGED_EMAILS: frozenset[str] = frozenset(
    e.lower() for e in _parse_csv(settings.managed_plan_emails)
)
_MANAGED_SUBS: frozenset[str] = _parse_csv(settings.managed_plan_subs)


def is_managed_eligible(principal: Principal | None, provider_id: str) -> bool:
    """True iff `principal` may use the managed path for `provider_id`.

    Phase-1 gate — ALL must hold: the caller is authenticated (a verified principal),
    is on the internal managed allowlist (email or sub), and the provider is actually
    offered managed (has a configured key, `vault.get_managed_key`). Anonymous callers
    and non-listed users return False and fall back to BYOK. Plans/entitlements + caps
    replace the allowlist in later phases.
    """
    if principal is None:
        return False
    on_allowlist = (
        bool(principal.email) and principal.email.strip().lower() in _MANAGED_EMAILS
    ) or (bool(principal.sub) and principal.sub in _MANAGED_SUBS)
    if not on_allowlist:
        return False
    return get_managed_key(provider_id) is not None
