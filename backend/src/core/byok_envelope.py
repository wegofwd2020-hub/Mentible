"""Per-job encryption envelope for BYOK API keys — re-export shim.

The implementation now lives in the shared `wegofwd-secure` package (ADR-019), so
there is exactly ONE copy of this security-critical code across the product
family. This module preserves the original import path
(`backend.src.core.byok_envelope`) and pins StudyBuddy's own HKDF
domain-separation string so derived keys are byte-identical to the
pre-extraction behaviour.

See ADR-001 for the BYOK key discipline and ADR-019 for the extraction rationale.
"""

from __future__ import annotations

from wegofwd_secure.envelope import EnvelopedKey, parse_master_key
from wegofwd_secure.envelope import decrypt_api_key as _decrypt_api_key
from wegofwd_secure.envelope import derive_job_key as _derive_job_key
from wegofwd_secure.envelope import encrypt_api_key as _encrypt_api_key

# StudyBuddy's original HKDF info string. Pinned here (rather than using the
# package's generic default) so per-job keys match the pre-extraction values.
_HKDF_INFO = b"studybuddy-q/byok/v1"

__all__ = [
    "EnvelopedKey",
    "decrypt_api_key",
    "derive_job_key",
    "encrypt_api_key",
    "parse_master_key",
]


def derive_job_key(master_key: bytes, job_id: str) -> bytes:
    """Derive a per-job 32-byte key (StudyBuddy HKDF info pinned)."""
    return _derive_job_key(master_key, job_id, info=_HKDF_INFO)


def encrypt_api_key(master_key: bytes, job_id: str, api_key: str) -> bytes:
    """Encrypt the user's API key for storage (StudyBuddy HKDF info pinned)."""
    return _encrypt_api_key(master_key, job_id, api_key, info=_HKDF_INFO)


def decrypt_api_key(master_key: bytes, job_id: str, envelope_blob: bytes) -> str:
    """Decrypt a stored envelope back into the user's API key (info pinned)."""
    return _decrypt_api_key(master_key, job_id, envelope_blob, info=_HKDF_INFO)
