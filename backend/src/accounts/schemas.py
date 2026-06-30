"""Request/response shapes for the account API (ADR-014).

Responses expose only the identity reference + credential-set metadata — never the
internal account UUID, and never key material (D8/D5).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from backend.src.accounts.models import CREDENTIAL_SOURCES, CREDENTIAL_STATUSES


class DeviceRegister(BaseModel):
    """Client report of the device it's signed in from (per-install). No key
    material — a stable client id plus a friendly label + platform."""

    device_id: str = Field(min_length=1, max_length=200)
    label: str | None = Field(default=None, max_length=200)
    platform: str | None = Field(default=None, max_length=40)


class AdminDeviceView(BaseModel):
    """One device in the admin detail view (metadata only)."""

    device_id: str
    label: str | None
    platform: str | None
    first_seen: datetime
    last_seen: datetime


class CredentialView(BaseModel):
    provider_id: str
    source: str
    status: str
    last_verified_at: datetime | None
    updated_at: datetime


class AccountView(BaseModel):
    # Identity reference only — `sub` + email. No internal id, nothing generated (D8).
    sub: str
    email: str | None
    credentials: list[CredentialView]
    # Whether this caller is an operator (config allowlist; derived at request time,
    # never trusted from a token claim — ADR-020 D2). Drives the admin entry point.
    is_super_admin: bool = False


class AdminUserSummary(BaseModel):
    """One row of the admin user list (ADR-020 D3.1). Metadata only — never key
    material, never generated content. No internal account UUID."""

    sub: str
    email: str | None
    created_at: datetime
    suspended: bool
    suspended_at: datetime | None


class AdminUserRow(AdminUserSummary):
    """A user list row: summary + how many devices the account has signed in from."""

    device_count: int = 0


class AdminUserDetail(AdminUserSummary):
    """One user for the admin detail view: summary + credential-set metadata
    (custody source + verification status only — never the key, D5) + the
    account's registered devices."""

    credentials: list[CredentialView]
    device_count: int = 0
    devices: list[AdminDeviceView] = []


class AdminUserList(BaseModel):
    users: list[AdminUserRow]
    total: int
    limit: int
    offset: int


class AdminAuditEntryView(BaseModel):
    """One persisted admin-action audit row (ADR-020 D5). Metadata only."""

    actor_sub: str
    actor_email: str | None
    action: str
    target_sub: str | None
    created_at: datetime


class AdminAuditList(BaseModel):
    entries: list[AdminAuditEntryView]
    total: int
    limit: int
    offset: int


class GrantEntitlementRequest(BaseModel):
    """Admin grant of a managed plan to an account (ADR-005 D6, Phase 3). The plan_id is
    validated against the plan registry in the route; status defaults to active; the
    period runs from now for the plan's window (or `period_days` if given)."""

    plan_id: str
    status: str = "active"
    period_days: int | None = Field(default=None, ge=1, le=366)


class EntitlementView(BaseModel):
    """An account's managed entitlement (admin view). Null when none is set."""

    plan_id: str
    status: str
    period_start: datetime
    period_end: datetime


class ManagedUsageView(BaseModel):
    """Server-side managed usage over the current window (ADR-005 D6, Phase 5)."""

    cost_micros: int
    input_tokens: int
    output_tokens: int
    events: int


class ManagedEntitlementView(BaseModel):
    """The caller's own entitlement, with the plan's display name."""

    plan_id: str
    plan_display: str
    status: str
    period_start: datetime
    period_end: datetime


class BillingUsageSummaryView(BaseModel):
    """Aggregate managed spend across all accounts over a window (admin margin view)."""

    window_days: int
    cost_micros: int
    events: int
    accounts: int


class ManagedStatusView(BaseModel):
    """The account-facing managed-billing status the client meter renders (Phase 5):
    the entitlement (null ⇒ no managed plan / BYOK), the window's usage, and the plan
    allowance (null ⇒ uncapped or no plan). `window_start` is the period the usage covers."""

    entitlement: ManagedEntitlementView | None
    usage: ManagedUsageView
    allowance_micros: int | None
    window_start: datetime


class CredentialUpsert(BaseModel):
    source: str  # validated against CREDENTIAL_SOURCES in the route
    status: str = "unverified"

    def validate_enums(self) -> str | None:
        """Return an error message if source/status are out of range, else None."""
        if self.source not in CREDENTIAL_SOURCES:
            return f"source must be one of {CREDENTIAL_SOURCES}"
        if self.status not in CREDENTIAL_STATUSES:
            return f"status must be one of {CREDENTIAL_STATUSES}"
        return None
