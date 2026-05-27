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


settings = Settings()  # type: ignore[call-arg]
