# Tester full-access (keyless Pro) — Design

**Status:** Approved (brainstorming, 2026-08-13).

**Context.** We are about to invite people to try Mentible. The just-shipped Slice-B Free/Pro
gates (Free = `FREE_MAX_PROJECTS=2`, `FREE_MAX_GENERATIONS=20` per `FREE_GEN_WINDOW_DAYS=30`,
EPUB/PDF export Pro-walled) block a fresh tester. We need a way to grant chosen testers **full
feature access AND keyless generation on our managed Anthropic key** (no BYOK friction).

The mechanisms mostly exist already (Slice A/B): `billing/access.is_pro` unlocks every Free/Pro
gate, and it is True for either an **active managed entitlement** OR a **staff-allowlisted** email/sub.
`managed_unlimited` (`plans.py`, `allowance_micros=0`) is the uncapped plan. What is missing is
prod **wiring** (the managed key + allowlist vars are not passed into the containers) and a
**console UI** to grant per-user without curl.

## Decisions (from brainstorming)

- **Grant vehicle:** BOTH — a config **email/sub allowlist** (cohort) AND a **console Grant-plan UI**
  (per-user, no deploy). Plan granted = **`managed_unlimited`** (full features + uncapped managed).
- **Generation:** **keyless** — testers generate on OUR managed Anthropic key (a prod secret we set),
  not BYOK.
- **Cost backstop:** wire `MANAGED_ACCOUNT_SPEND_CEILING_MICROS` so "unlimited" still has a
  per-account runaway ceiling we can set (unlimited plan + default-0 ceiling = literally uncapped).

## The gate model (existing, for reference)

- `access.is_pro(conn, *, account_id) -> bool` = True iff (active entitlement whose period covers now)
  OR `eligibility.is_staff_allowlisted(sub, email)`. Drives ALL Slice-B walls (projects/generations/export).
- `access.resolve_managed_access(...)` decides keyless generation: entitlement plan's `managed_providers`
  + allowance, OR the staff override (cap = `MANAGED_PERIOD_COST_CAP_MICROS`, source `"staff"`).
  Requires `vault.get_managed_key(provider_id)` to be configured — else the provider is absent ⇒ BYOK only.
- `vault.get_managed_key("anthropic")` reads `settings.managed_anthropic_api_key`
  (env `MANAGED_ANTHROPIC_API_KEY`). Unset today in prod ⇒ managed off.
- `eligibility._MANAGED_EMAILS/_SUBS` are computed **at import** from `settings.managed_plan_emails/subs`
  ⇒ an env change needs a **container recreate** to reload.

## Architecture

### Part A′ — prod wiring (`docker-compose.demo.yml`)

The demo compose passes env via explicit `environment:` blocks on **both** the `api` and
`celery-worker` services (the worker imports the same backend, needs the same env). Neither block
currently wires the managed vars. Add to BOTH blocks (mirror the `SUPER_ADMIN_EMAILS` pattern —
optional, empty default, so nothing hard-fails when unset):

```yaml
      # ── Managed billing (ADR-005 D6) — grant testers Pro + keyless managed gen ──
      MANAGED_ANTHROPIC_API_KEY: ${MANAGED_ANTHROPIC_API_KEY:-}          # OUR key; empty ⇒ managed off
      MANAGED_PLAN_EMAILS: ${MANAGED_PLAN_EMAILS:-}                       # email cohort ⇒ Pro
      MANAGED_PLAN_SUBS: ${MANAGED_PLAN_SUBS:-}
      MANAGED_ACCOUNT_SPEND_CEILING_MICROS: ${MANAGED_ACCOUNT_SPEND_CEILING_MICROS:-0}  # runaway backstop
      # Free caps — tunable without a rebuild (code defaults already 2/20/30)
      FREE_MAX_PROJECTS: ${FREE_MAX_PROJECTS:-2}
      FREE_MAX_GENERATIONS: ${FREE_MAX_GENERATIONS:-20}
      FREE_GEN_WINDOW_DAYS: ${FREE_GEN_WINDOW_DAYS:-30}
```

`MANAGED_ANTHROPIC_API_KEY` is OUR live provider credential — treated exactly like a BYOK key
(ADR-001): env → `settings` → vault → the provider call, NEVER logged. No new code path; the vault
already reads it.

**Prod secrets (you set in `.env.demo`, ROOT):** `MANAGED_ANTHROPIC_API_KEY=sk-ant-…` (required for
keyless), optionally `MANAGED_PLAN_EMAILS=tester1,tester2,…` (config cohort), and a sensible
`MANAGED_ACCOUNT_SPEND_CEILING_MICROS` (e.g. a per-account $ cap in micro-USD) as the unlimited-plan
backstop.

### Part C — console Grant-plan UI

Backend `GET`/`PUT /api/v1/admin/users/{sub}/entitlement` already exist (super-admin, audited) and
are LIVE. Two additions:

- **Backend — `GET /api/v1/admin/plans`** (super-admin) → the plan catalog for the picker, so the UI
  can't drift from `plans.py`. Builds `[{ id, display, allowance_micros, managed_providers }]` by
  mapping `plans.plan_ids()` through `plans.get_plan(...)` (no `all_plans` accessor exists;
  `managed_providers` is a `frozenset` → serialize as a sorted list). New `PlanSummary` schema in
  `backend/src/accounts/schemas.py` (where the entitlement schemas live). Read-only, no audit.
- **Mobile — `adminClient.ts`:** `listPlans(token)`, `getEntitlement(token, sub)`,
  `grantEntitlement(token, sub, planId)` (PUT body `{ plan_id, status: "active" }`; period defaults
  server-side to the plan window), `revokeEntitlement(token, sub)` (PUT `{ plan_id, status: "canceled" }`
  on the current plan — matches `ENTITLEMENT_STATUSES`; no DELETE endpoint). Plus an `EntitlementView`
  + `PlanSummary` type. (`GrantEntitlementRequest = {plan_id, status="active", period_days?}`;
  `EntitlementView = {plan_id, status, period_start, period_end}` — both in `accounts/schemas.py`.)
- **Mobile — `admin/[sub].tsx`:** a new **"Plan"** section (below Providers): shows the current
  entitlement (plan display resolved via `listPlans` · `status` · period, or "No managed plan — Free"), a **Grant** control
  (buttons/picker for each plan from `listPlans`, primary = Managed Unlimited), and a **Revoke** when
  an active plan exists. On success, refetch the entitlement. Uses `useThemedStyles` tokens + `Alert`
  from `@/lib/alert` (renders on web too). Super-admin-gated by the existing screen guard.

### The two grant paths, once A′ is live

1. **Config cohort:** add emails to `MANAGED_PLAN_EMAILS` in `.env.demo` + recreate ⇒ those accounts
   are Pro + managed-eligible (source `"staff"`, cap `MANAGED_PERIOD_COST_CAP_MICROS`).
2. **Per-user (recommended for onboarding):** in the console, open the tester (after they sign in) →
   Grant → **Managed Unlimited**. Writes the `entitlement` row ⇒ Pro + uncapped managed. No deploy.

## Testing

- **A′:** `docker compose -f docker-compose.demo.yml config` parses (both services carry the new keys);
  a backend test asserting the four settings (`managed_anthropic_api_key`, `managed_plan_emails`,
  `managed_account_spend_ceiling_micros`, `free_max_projects`) load from env into `Settings`.
- **C backend:** `GET /admin/plans` returns the catalog for a super-admin; 403 for a non-admin; the
  payload includes `managed_unlimited` with `allowance_micros == 0`.
- **C mobile (RNTL):** the Plan section renders the current entitlement; the Grant control calls
  `grantEntitlement(sub, "managed_unlimited")` (mock adminClient) and refetches; Revoke calls
  `revokeEntitlement`; empty state shows "Free". No color-literal asserts.

## Rollout

**Backend refresh** (rebuild not required for env, but the compose file changes — deploy ships the
updated compose; recreate `api` + `celery-worker` to reload env) **+ web deploy** (the console UI).
No DB migration (the `entitlement` table exists). Then set the prod secrets and grant the first cohort.

## Out of scope

- The payment rail (Slice C — Stripe/RevenueCat). Per-tester managed-cost dashboards beyond the
  existing `managed_spend_alarm` log. Self-serve upgrade UI. BYOK-vs-managed routing changes.

## Global constraints

- ADR-001 key discipline: the managed key is a live credential — never logged, DB'd, or in a traceback.
- Super-admin gating: `GET /admin/plans` + the grant/revoke actions require `require_super_admin`
  (config-derived, never a token claim). The console screen already gates on `is_super_admin`.
- No color-literal asserts; theme via `useThemedStyles`/tokens; `Alert` from `@/lib/alert`.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
