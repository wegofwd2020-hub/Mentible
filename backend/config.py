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

    # ── Super-admin operator role (ADR-020 D1) ────────────────────────────────
    # A small allowlist of verified IdP identities that get the runtime admin
    # console. An account is super-admin iff its JWKS-VERIFIED email (or sub) is
    # listed here — NOT a JWT claim a client could assert (D2), NOT a DB role at
    # MVP. Comma-separated; empty/unset ⇒ NO admins (safe default; the anonymous
    # demo and ordinary users are unaffected). This is the human OPERATOR role
    # (ADR-020) and is deliberately distinct from the system_owner_secret above
    # (ADR-018) — that is a cryptographic signing capability, this is who-may-ask
    # (ADR-020 D4). Email is the operator-friendly key (matched case-insensitively
    # against the verified `email` claim); sub is allowed for stability if an email
    # ever changes.
    super_admin_emails: str = Field(
        default="", description="comma-separated admin emails; empty = no admins"
    )
    super_admin_subs: str = Field(
        default="", description="comma-separated admin IdP subs; empty = none"
    )

    # ── Managed billing (ADR-005 D6; MANAGED_BILLING_BUILD_PLAN.md, Phase 1) ───
    # The managed-key "vault" (option A — env/secret storage). OUR company provider
    # key(s) for the managed path: held server-side, used per job, and treated with
    # the SAME no-log discipline as byok_master_key (ADR-001 / ADR-005 D3) — never a
    # log line, DB row, or traceback. Empty ⇒ that provider is simply not offered
    # managed (graceful — BYOK is unaffected). Phase 1 is Anthropic-only; add a
    # provider here only once its ToS clears for managed (ADR-005 O4). This is the
    # wegofwd-billing *mechanism* (vault) storage; see backend/src/billing/vault.py.
    managed_anthropic_api_key: str | None = Field(
        default=None, description="OUR managed Anthropic key; empty = managed off"
    )
    # Multi-provider managed keys (Phase 6). Each provider is offered managed only once its
    # ToS clears (ADR-005 O4 — all four cleared) AND a key is set here. ⚠ Gemini: use a PAID
    # key only — the free tier trains on / human-reviews data (O4), incompatible with managed.
    managed_openai_api_key: str | None = Field(default=None)
    managed_groq_api_key: str | None = Field(default=None)
    managed_gemini_api_key: str | None = Field(default=None)
    # Hard per-account spend ceiling in micro-USD over the usage window (Phase 6, O7) — a
    # backstop that bounds OUR spend even on an unlimited plan or the staff override, against
    # a runaway client / compromised account. 0 ⇒ no ceiling. Independent of the plan allowance.
    managed_account_spend_ceiling_micros: int = Field(default=0, ge=0)
    # Emit a `managed_spend_alarm` warning when an account crosses this fraction of its
    # effective limit (allowance or ceiling) — an ops/anomaly signal. 0 ⇒ alarm off.
    managed_spend_alarm_fraction: float = Field(default=0.8, ge=0.0, le=1.0)
    # Internal "staff-managed" allowlist for Phase 1 — who may use the managed path
    # before plans/entitlements/billing exist (those replace this in phases 3–4).
    # Per-app POLICY (ADR-019), config-only (never a token claim — same discipline as
    # the super-admin allowlist), comma-separated; empty ⇒ nobody is managed-eligible
    # (safe default; everyone keeps using BYOK). See backend/src/billing/eligibility.py.
    managed_plan_emails: str = Field(
        default="", description="comma-separated internal managed-plan emails; empty = none"
    )
    managed_plan_subs: str = Field(
        default="", description="comma-separated internal managed-plan IdP subs; empty = none"
    )
    # Phase 2 metering cap (ADR-005 D6). A single fixed managed cost cap, in micro-USD
    # (1e-6 USD), over a rolling window — enough to prove the metering→cap loop before
    # the per-plan allowance model (Phase 3). 0 ⇒ uncapped (metered but never refused;
    # the safe default so managed works the moment a key + allowlist are set). Per-plan
    # allowances replace this in Phase 3.
    managed_period_cost_cap_micros: int = Field(default=0, ge=0)
    managed_usage_window_days: int = Field(default=30, ge=1, le=366)
    # Phase 4 billing (RevenueCat → entitlement, ADR-005 O1). The shared secret RevenueCat
    # sends as the webhook's `Authorization` header (set in the RC dashboard); empty ⇒ the
    # webhook is DISABLED (returns 401), so an unconfigured deploy can't be spoofed. Secret
    # — redacted in logs, set per environment, never committed.
    revenuecat_webhook_auth: str = Field(
        default="", description="RevenueCat webhook Authorization header secret; empty = disabled"
    )
    # Maps RevenueCat product ids → our plan ids: "rc_product_a:managed_basic,rc_b:managed_unlimited".
    # An unmapped product is ignored (the webhook no-ops). Comma-separated `product:plan` pairs.
    revenuecat_product_plan_map: str = Field(
        default="", description="comma-separated RevenueCat product_id:plan_id pairs"
    )

    # ── Account store (ADR-014 D2/D8) — Supabase Postgres via asyncpg ──────────
    # The account + per-provider credential-set DB. OPTIONAL, like identity: empty
    # = no DB (anonymous demo; the pool is None and account routes are unavailable),
    # never a startup failure. asyncpg DSN, e.g. postgresql://user:pass@host/db.
    # Isolation is app-level (WHERE idp_sub = principal.sub), not RLS — the backend
    # is the single data path and already verifies the JWT (CLAUDE.md rule 4).
    database_url: str = Field(default="", description="asyncpg DSN; empty = DB disabled")

    # ── Supabase Auth admin — account-deletion removes the identity (amends ADR-014) ──
    # By default the account/admin delete endpoints purge only the app DB row and
    # leave the Supabase auth user intact, so the same email signs back in as a
    # *returning* identity (ADR-014's "no auth machinery / no service-role secret
    # in the app"). Setting this high-privilege service-role key turns on a hard
    # delete of the Supabase auth user too, so a deleted email can re-register as a
    # brand-new user — see ADR-022. OPTIONAL: empty ⇒ identity deletion disabled
    # (pre-existing app-row-only behavior), never a startup failure. HIGH-PRIVILEGE
    # SECRET: never logged (ADR-001 discipline), never persisted.
    supabase_service_role_key: str = Field(
        default="", description="empty = identity deletion disabled"
    )
    # Supabase project base URL (https://<ref>.supabase.co). Empty ⇒ derive from
    # oidc_issuer (strip a trailing /auth/v1), matching scripts/reset_test_user.py.
    supabase_url: str = Field(default="", description="empty = derive from oidc_issuer")

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

    @property
    def resolved_supabase_url(self) -> str:
        """Supabase project base URL for the Auth Admin API. Prefers the explicit
        `supabase_url`; otherwise derives it from `oidc_issuer` by stripping a
        trailing `/auth/v1`. Empty string if neither is configured."""
        if self.supabase_url:
            return self.supabase_url.rstrip("/")
        issuer = self.oidc_issuer.rstrip("/")
        suffix = "/auth/v1"
        return issuer[: -len(suffix)] if issuer.endswith(suffix) else issuer


settings = Settings()  # type: ignore[call-arg]
