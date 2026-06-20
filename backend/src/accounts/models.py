"""Account + per-provider credential-set model — ADR-014 D2/D3/D8.

The account holds only an identity reference (the IdP `sub`, D8) and a pointer to
the synced library — **nothing about what the user generates**. The credential set
is per-provider *metadata* (custody + verification status); it stores **no key
material** — the BYOK key stays device-local or is synced as ciphertext (D5).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

# Where a provider's key lives (ADR-014 D2/D3). Never blurred: a device_local
# (BYOK) key is never silently promoted to managed_vault (D3).
CREDENTIAL_SOURCES = ("device_local", "synced_e2e", "managed_vault")
# Last-known verification state of that key (ADR-014 D2).
CREDENTIAL_STATUSES = ("valid", "rejected", "unverified")


@dataclass(frozen=True)
class Account:
    id: UUID
    idp_sub: str  # the verified IdP subject — the account key (D8)
    email: str | None
    created_at: datetime
    synced_library_ref: str | None
    # Operator suspend flag (ADR-020 D3.1). Enforced on authed routes by
    # require_active_user; does NOT stop public BYOK generation (O6).
    suspended: bool = False
    suspended_at: datetime | None = None


@dataclass(frozen=True)
class ProviderCredential:
    """One entry of the registry-keyed credential set (ADR-014 D2). Rows, not
    columns — adding a provider needs no migration. Holds NO key, only custody +
    status metadata."""

    provider_id: str  # a PROVIDER_REGISTRY id (ADR-012)
    source: str  # one of CREDENTIAL_SOURCES
    status: str  # one of CREDENTIAL_STATUSES
    last_verified_at: datetime | None
    updated_at: datetime
