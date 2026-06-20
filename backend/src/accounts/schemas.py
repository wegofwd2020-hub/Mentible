"""Request/response shapes for the account API (ADR-014).

Responses expose only the identity reference + credential-set metadata — never the
internal account UUID, and never key material (D8/D5).
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from backend.src.accounts.models import CREDENTIAL_SOURCES, CREDENTIAL_STATUSES


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


class AdminUserDetail(AdminUserSummary):
    """One user for the admin detail view: summary + credential-set metadata
    (custody source + verification status only — never the key, D5)."""

    credentials: list[CredentialView]


class AdminUserList(BaseModel):
    users: list[AdminUserSummary]
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
