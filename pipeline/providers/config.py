"""
pipeline/providers/config.py

Two-level LLM configuration with versioning (Siva, 2026-06-01):

  1. AUTHOR level — a top-level preference applied to all the author's work.
  2. BOOK level   — optional per-book customization layered on top.

Both levels use the same `LLMConfig` (all fields optional, so a level states
only what it sets; unset fields inherit from the level above). `resolve_llm_config`
merges them into an effective choice and carries BOTH version numbers, so each
generation's provenance records exactly which author+book config produced it and
we can detect drift later.

Resolution rules:
- Precedence: book override > author default > global ROLE_DEFAULTS.
- `allowed`: AUTHOR IS THE CEILING — effective = author_allowed ∩ book_allowed.
  A book can narrow the set but cannot re-enable a provider the author globally
  excluded. (None at a level = "no opinion / inherit".)
- model coherence: a level's `model` is inherited only if that level did not pin
  a DIFFERENT provider — so you never get provider X with a model meant for Y.

Additive / Mentible-owned: imports only sibling provider modules.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass

from pipeline.providers.registry import (
    PROVIDER_REGISTRY,
    provenance as _registry_provenance,
    resolve_role,
    validate_selection,
)


@dataclass(frozen=True)
class LLMConfig:
    """LLM preferences at one level (author OR book). `version` is assigned by
    the app and bumped whenever the level's config is edited."""

    allowed: frozenset[str] | None = (
        None  # provider include-set; None = inherit / unrestricted
    )
    provider: str | None = None  # preferred default provider
    model: str | None = None  # preferred default model
    version: int = 0  # app-assigned; bump on edit

    @staticmethod
    def of(
        allowed: Iterable[str] | None = None,
        provider: str | None = None,
        model: str | None = None,
        version: int = 0,
    ) -> "LLMConfig":
        """Convenience builder that normalizes `allowed` to a frozenset."""
        return LLMConfig(
            allowed=None if allowed is None else frozenset(allowed),
            provider=provider,
            model=model,
            version=version,
        )


@dataclass(frozen=True)
class ResolvedLLMConfig:
    allowed: frozenset[str] | None  # effective include-set (None = unrestricted)
    provider: str
    model: str
    author_version: int
    book_version: int | None  # None when there is no book-level config

    def fingerprint(self) -> str:
        """Stable short hash of the EFFECTIVE settings — changes iff the resolved
        choice changes, regardless of version-number bookkeeping."""
        payload = json.dumps(
            {
                "allowed": sorted(self.allowed) if self.allowed is not None else None,
                "provider": self.provider,
                "model": self.model,
            },
            sort_keys=True,
        )
        return hashlib.sha256(payload.encode()).hexdigest()[:16]

    def provenance(self) -> dict:
        """Full version vector to stamp on a generation: the registry/contract
        axes plus the two config-level versions and the effective fingerprint."""
        prov = _registry_provenance(self.provider, self.model)
        prov.update(
            {
                "author_config_version": self.author_version,
                "book_config_version": self.book_version,
                "config_fingerprint": self.fingerprint(),
            }
        )
        return prov


def _effective_allowed(
    author: LLMConfig, book: LLMConfig | None
) -> frozenset[str] | None:
    a = author.allowed
    b = book.allowed if book else None
    if a is None and b is None:
        return None  # unrestricted
    if a is None:
        return frozenset(b)  # book narrows from "all"
    if b is None:
        return frozenset(a)  # author's set, no book opinion
    return frozenset(a) & frozenset(b)  # author is the ceiling


def _pick_model(level: LLMConfig | None, provider: str) -> str | None:
    """A level contributes its model only if it didn't pin a different provider."""
    if level is None or not level.model:
        return None
    if level.provider is None or level.provider == provider:
        return level.model
    return None


def resolve_llm_config(
    author: LLMConfig,
    book: LLMConfig | None = None,
    *,
    role: str = "authoring",
) -> ResolvedLLMConfig:
    """Merge author + (optional) book config into the effective LLM choice.

    Raises LLMConfigurationError (unknown provider) or LLMNotAllowedError (the
    resolved provider is excluded by the effective allow-list — e.g. a book
    pinned to a provider the author later globally excluded)."""
    role_provider, role_model = resolve_role(role)

    provider = (book.provider if book else None) or author.provider or role_provider
    allowed = _effective_allowed(author, book)

    # Validates: provider is known AND within the effective allow-list.
    provider, _ = validate_selection(provider, allowed=allowed)

    model = (
        _pick_model(book, provider)
        or _pick_model(author, provider)
        or (role_model if provider == role_provider else None)
        or PROVIDER_REGISTRY[provider].default_model
    )

    return ResolvedLLMConfig(
        allowed=allowed,
        provider=provider,
        model=model,
        author_version=author.version,
        book_version=book.version if book else None,
    )


# Provenance keys that, if changed, mean a generation is out of date w.r.t. the
# current resolved config (the model/provider, our integration, the seam shape,
# or either config level).
_DRIFT_KEYS = (
    "provider",
    "model",
    "integration_version",
    "contract_version",
    "author_config_version",
    "book_config_version",
)


def is_stale(stamped: dict, resolved: ResolvedLLMConfig) -> bool:
    """True if a generation's stamped provenance differs from `resolved` on any
    drift axis — i.e. it should be flagged for (or offered) regeneration."""
    current = resolved.provenance()
    return any(stamped.get(k) != current.get(k) for k in _DRIFT_KEYS)
