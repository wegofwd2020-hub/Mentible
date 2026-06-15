"""Backend configuration for StudyBuddy Q.

All values come from environment variables. No defaults for secrets — fail
fast at startup if any required value is missing.
"""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# Repo root = parent of the backend/ directory; used to locate the sibling Node
# artifact compiler by default.
_REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Service ───────────────────────────────────────────────────────────────
    app_env: str = Field(default="development", description="development | test | production")
    log_level: str = Field(default="INFO")

    # ── Redis (job queue + transient BYOK key envelope) ───────────────────────
    redis_url: str = Field(default="redis://localhost:6379/0")

    # ── BYOK ──────────────────────────────────────────────────────────────────
    # 32-byte hex string (64 hex chars). Used as the master key from which
    # per-job ephemeral keys are derived via HKDF. See ADR-001.
    # No default — startup MUST fail if this is unset.
    byok_master_key: str = Field(min_length=64, max_length=64)

    # Default lifetime for an in-flight job's encrypted key in Redis.
    # 120 s is plenty for an Anthropic call (Sonnet 4.6 latency p95 ~30 s).
    byok_redis_ttl_seconds: int = Field(default=120, ge=10, le=600)

    # ── System owner (super-admin) principal — ADR-018 ────────────────────────
    # A single privileged principal that owns the default application + library
    # (ADR-017) and may publish/curate it. It is NOT a user account and NOT a role
    # on the user IdP (ADR-018 D1) — it is bootstrapped here from env config.
    #
    # Stable identifier used as the default library's publisher/owner of record
    # and as the actor in owner-action audit logs (ADR-018 D2/D6). Non-secret, so
    # a default is fine; override per environment.
    system_owner_id: str = Field(default="mentible-system-owner")
    # Owner auth secret / signing key for owner-only actions (publishing a book
    # into the default set, vault ops). 64-hex (32 bytes) — same shape as
    # byok_master_key; generate with `openssl rand -hex 32`. SECRET: no default,
    # so startup MUST fail if unset (fail-fast, ADR-018 D1). Redacted in logs and
    # never persisted in the clear (ADR-018 D6 / ADR-001 discipline).
    system_owner_secret: str = Field(min_length=64, max_length=64)

    # ── Anthropic / model ─────────────────────────────────────────────────────
    anthropic_default_model: str = Field(default="claude-sonnet-4-6")

    # ── Artifact compiler (Node) ──────────────────────────────────────────────
    # POST /export shells out to the Node EPUB/PDF compiler (compiler/dist/cli.js).
    # Compilation is deterministic and KEY-FREE (no Anthropic key). Build it with
    # `cd compiler && npm run build`. These are paths, not secrets, so defaults
    # are fine; override via NODE_BIN / COMPILER_CLI in other layouts.
    node_bin: str = Field(default="node")
    compiler_cli: str = Field(default=str(_REPO_ROOT / "compiler" / "dist" / "cli.js"))
    export_timeout_seconds: int = Field(default=300, ge=5, le=1800)
    # Diagram rendering runs one headless-Chromium pass per Mermaid block, so a
    # diagram-laden book takes minutes — give that path a much longer ceiling.
    export_diagram_timeout_seconds: int = Field(default=1200, ge=5, le=3600)


settings = Settings()  # type: ignore[call-arg]
