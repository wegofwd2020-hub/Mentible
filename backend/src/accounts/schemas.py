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
