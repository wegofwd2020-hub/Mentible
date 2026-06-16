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

    # ── User identity (ADR-014 D1) — external IdP verified by JWKS ─────────────
    # We build NO authentication: login is the IdP's job (O1 → Supabase), and the
    # backend only *verifies* its JWT statelessly via JWKS. No auth DB, no secret.
    # Identity is OPTIONAL at MVP — the anonymous demo runs with these unset, and
    # the auth dependencies treat "no issuer configured" as anonymous (never a
    # startup failure). Set them to turn identity on for a deployment.
    #
    # Supabase: issuer = https://<project-ref>.supabase.co/auth/v1 ; the default
    # access-token audience is "authenticated". JWKS is discovered at
    # <issuer>/.well-known/jwks.json unless oidc_jwks_url overrides it.
    oidc_issuer: str = Field(default="", description="OIDC issuer URL; empty = identity disabled")
    oidc_audience: str = Field(default="authenticated", description="expected JWT aud claim")
    oidc_jwks_url: str = Field(
        default="", description="override JWKS URL; empty = derive from issuer"
    )

    # ── Account store (ADR-014 D2/D8) — Supabase Postgres via asyncpg ──────────
    # The account + per-provider credential-set DB. OPTIONAL, like identity: empty
    # = no DB (anonymous demo; the pool is None and account routes are unavailable),
    # never a startup failure. asyncpg DSN, e.g. postgresql://user:pass@host/db.
    # Isolation is app-level (WHERE idp_sub = principal.sub), not RLS — the backend
    # is the single data path and already verifies the JWT (CLAUDE.md rule 4).
    database_url: str = Field(default="", description="asyncpg DSN; empty = DB disabled")

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

    # ── Rate limiting ─────────────────────────────────────────────────────────
    # Fixed-window per-identity limits on the expensive endpoints (/generate,
    # /structure, /export). Keyed on the auth principal (sub) when present, else
    # the client IP. Both an abuse guard and a cost-control lever for managed
    # token spend (ADR-005). Disable for load tests with rate_limit_enabled=False
    # (or set a limit to 0). Counters live in Redis with TTL = the window.
    rate_limit_enabled: bool = Field(default=True)
    # Burst guard. A sequential generate-all stays well under this (each topic is
    # a multi-second job), so it only trips scripted abuse.
    rate_limit_per_minute: int = Field(default=20, ge=0)
    # Daily cap (cost-control). ~16 full 30-topic books/day; well within the D18
    # ~100-unit fair-use posture while allowing regeneration/iteration.
    rate_limit_per_day: int = Field(default=500, ge=0)


settings = Settings()  # type: ignore[call-arg]
