"""RevenueCat webhook → entitlement mapping — the wegofwd-billing MECHANISM (pure).

Translates a RevenueCat webhook payload into an intent against our `entitlement` model
(ADR-005 D6, Phase 4). Pure and I/O-free: the router does the auth check, account lookup,
and DB write; this module only decides *what* an event means. RevenueCat's `app_user_id`
is our account's IdP `sub` (the client calls `Purchases.logIn(sub)`), so the router maps
it straight to an account.

Event handling:
- **Granting** (purchase / renewal / change / uncancellation / non-renewing) → entitlement
  **active** for the plan the product maps to, through the event's expiration.
- **EXPIRATION** → **canceled** (access ends).
- **BILLING_ISSUE** → **past_due**.
- **CANCELLATION** (auto-renew off — access continues until expiry), TRANSFER, PAUSE, etc.
  → ignored (None); the eventual EXPIRATION is what ends access.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

# Event types that grant or extend access.
_GRANTING = frozenset(
    {"INITIAL_PURCHASE", "RENEWAL", "PRODUCT_CHANGE", "UNCANCELLATION", "NON_RENEWING_PURCHASE"}
)
_EXPIRING = frozenset({"EXPIRATION"})
_PAST_DUE = frozenset({"BILLING_ISSUE"})


@dataclass(frozen=True)
class EntitlementIntent:
    """What a RevenueCat event implies for an account's entitlement."""

    app_user_id: str  # our account's IdP sub
    action: str  # "grant" | "set_status"
    status: str  # active | canceled | past_due
    plan_id: str | None  # for "grant"
    period_end: datetime | None  # for "grant"; None ⇒ caller uses the plan window


def parse_product_plan_map(raw: str) -> dict[str, str]:
    """Parse `product_id:plan_id,product_id2:plan_id2` config into a dict."""
    out: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        product, plan = (s.strip() for s in pair.split(":", 1))
        if product and plan:
            out[product] = plan
    return out


def _expiration(event: dict) -> datetime | None:
    ms = event.get("expiration_at_ms")
    if not ms:
        return None
    return datetime.fromtimestamp(int(ms) / 1000, tz=UTC)


def map_event(payload: dict, product_plan_map: dict[str, str]) -> EntitlementIntent | None:
    """A RevenueCat webhook payload → an entitlement intent, or None to ignore the event."""
    event = payload.get("event") or {}
    etype = event.get("type")
    app_user_id = event.get("app_user_id")
    if not etype or not app_user_id:
        return None

    if etype in _GRANTING:
        plan_id = product_plan_map.get(event.get("product_id", ""))
        if not plan_id:
            return None  # product not mapped to one of our plans → ignore
        return EntitlementIntent(app_user_id, "grant", "active", plan_id, _expiration(event))
    if etype in _EXPIRING:
        return EntitlementIntent(app_user_id, "set_status", "canceled", None, None)
    if etype in _PAST_DUE:
        return EntitlementIntent(app_user_id, "set_status", "past_due", None, None)
    return None
