# In-shell usage meter (+ metering accuracy) — Slice A — Design

**Status:** Approved (brainstorming, 2026-08-13). First slice of the deferred "Stripe / usage-meter"
work. Surfaces the **in-shell usage meter** (the Lovable prototype's standout) reading the **existing**
managed-billing data, and fills the metering-accuracy gap so the meter counts ALL managed generation.
**No payment rail, no Stripe, no gating** — those are later slices (rails TBD).

## What already exists (do NOT rebuild)

- **Backend billing spine** (ADR-005 Phases 1–6, live but dormant): plans/pricing/eligibility/entitlements/
  usage metering/managed vault. `GET /api/v1/billing/managed-status` returns `{ entitlement (null ⇒
  BYOK/no plan), usage: {cost_micros,input_tokens,output_tokens,events}, allowance_micros (null ⇒ no plan,
  0 ⇒ unlimited), window_start }`. Migrations `0005_usage_event` + `0006_entitlement` applied.
- **Mobile:** `billingClient.getManagedStatus(token): Promise<ManagedStatus>` (fully typed) + a dedicated
  **`/usage` meter screen** (Settings → Usage), refetch-on-focus.
- **Metering on the main `/generate` path:** `_record_managed_usage(...)` prices observed tokens and appends
  a `usage_event`, best-effort, managed-only, never fails the generation.

## The two gaps this slice fills

1. **No in-shell meter.** The meter is only a buried screen; the Lovable standout is a compact quota
   indicator in the **app chrome**, visible everywhere.
2. **Trust generation is uncounted.** The 3 trust async generators (`suggest_toc`, `generate_topic_draft`,
   `generate_draft`) call `generate_validated(...).parsed` — discarding the `ConformanceResult`'s
   `total_input_tokens`/`total_output_tokens`. So managed per-topic / suggest-TOC / whole-book generation
   records **no `usage_event`** → the meter undercounts and a managed user could exceed allowance while the
   meter reads low.

## Architecture

### Backend — metering accuracy (so the meter doesn't lie)
- **Generators expose tokens.** Change `suggest_toc` / `generate_topic_draft` / `generate_draft` to return
  the full `ConformanceResult` (which already carries `.parsed` + `.total_input_tokens` +
  `.total_output_tokens`) instead of bare `.parsed`. Callers read `.parsed` (e.g. `toc_output_to_view(
  result.parsed, sources)`).
- **A shared trust-metering helper** in `backend/src/trust/tasks.py` (mirrors `generate/tasks.py`'s
  `_record_managed_usage`): `_record_trust_usage(conn, *, account_id, provider, model, input_tokens,
  output_tokens, job_id)` — prices via `pricing.cost_micros` and `usage_repo.record_usage`; **best-effort**
  (swallow any error with a warning — metering must NEVER fail a generation); **managed-only** (caller
  guards).
- **Wire into the 3 trust tasks** (`_run` / `_run_suggest` / `_run_version`): after a successful generation,
  `if managed:` resolve `account_id` from `recorded_by_sub` (`accounts_repo.get_or_create_account(conn,
  idp_sub=recorded_by_sub, email=None)`), then `_record_trust_usage(conn, account_id=…, provider=provider_id,
  model=resolved_model, input_tokens=result.total_input_tokens, output_tokens=result.total_output_tokens,
  job_id=job_id)`. Use the task's existing asyncpg conn. BYOK jobs record nothing (the `if managed` guard).
- **ADR-001:** usage recording is counts/cost only — no key, no content. The best-effort swallow logs a safe
  warning (`managed_usage_record_failed`), never `str(exc)`.

### Mobile — the in-shell meter
- **`useManagedStatus` hook** (`mobile/src/hooks/useManagedStatus.ts`): fetches `getManagedStatus` when
  signed-in + has a token; refetch on focus; exposes `{ status: ManagedStatus | null, loading }`. Returns
  `null` (→ meter hidden) when signed-out or the fetch fails (the meter is non-critical chrome — never block
  or error the app on a billing fetch).
- **`UsageMeterPill` component** (`mobile/src/components/UsageMeterPill.tsx`): given a `ManagedStatus`,
  renders a compact pill — `plan_display · $used / $cap` (format micros → dollars) + a thin bar
  (`cost_micros / allowance_micros`, clamped 0–100%). `allowance_micros === 0` (unlimited) → show
  `plan_display · $used · unlimited`, no bar. **Renders nothing when `entitlement === null`** (BYOK /
  anonymous / dormant — no plan, no clutter). Semantic color as the bar approaches/exceeds the cap
  (normal / warning ≥80% / over ≥100%) via theme tokens; `accessibilityRole` + a label carrying the same
  text. No color literals.
- **Wire into the chrome** (`TopNavBar`, and `SideNav` on wide): render `<UsageMeterPill>` (from a small
  wrapper that calls `useManagedStatus` and the pill) in the bar; tap → `router.push("/usage")` (the
  existing screen). Placement must not break the existing horizontal-scroll nav row; hidden-when-null keeps
  BYOK/anonymous chrome unchanged.

## Testing

- **Backend:** a **managed** trust job records a `usage_event` with the priced cost + the generator's
  tokens (per-topic, suggest, whole-book — at least one task covered end-to-end, the others by the shared
  helper); a **BYOK** job records nothing; a metering failure (mock `record_usage` to raise) does NOT fail
  the job (status still `done`, version still created); **no api key in the usage row or logs** (extend the
  no-key assertions). Generators return the `ConformanceResult` and callers still produce identical content.
- **Mobile:** `UsageMeterPill` renders the plan + used/cap + bar for an entitled status; renders **nothing**
  for `entitlement: null`; unlimited (`allowance_micros: 0`) shows no bar; ≥80% warning / ≥100% over states.
  `useManagedStatus` returns null when signed-out and doesn't throw on a failed fetch. The chrome wiring
  shows the pill only when entitled and navigates to `/usage` on tap. No color-literal asserts.

## Decomposition (SDD)

- **T1 — backend metering gap-fill:** generators return `ConformanceResult`; `_record_trust_usage` helper;
  wire the 3 trust tasks (managed-only, best-effort, ADR-001). Backend tests incl. no-key + never-fails.
- **T2 — mobile meter primitives:** `useManagedStatus` hook + `UsageMeterPill` component. Component/hook tests.
- **T3 — wire the pill into the chrome:** `TopNavBar` + `SideNav`; hidden-when-null; tap → `/usage`. Screen tests.

## Rollout

**Backend refresh** (worker records trust usage — recreate the celery-worker) **+ web deploy** (the meter).
**No migration** (usage_event/entitlement exist). Order flexible; the meter reads existing data and the
gap-fill only adds rows.

## Out of scope (later slices, rails TBD)

- Payment rail (Stripe web vs RevenueCat/Play) → grant entitlements for real money. Free/Pro gating +
  Publish Pro-wall. Any change to the `/usage` screen itself (it already exists). The `wegofwd-billing`
  package extraction.

## Global constraints

- **ADR-001:** usage recording carries no key/content; best-effort swallow logs a safe warning, never
  `str(exc)`; metering NEVER fails a generation. **The meter is non-critical chrome** — a billing-fetch
  failure hides the meter, never errors the app.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. No color-literal asserts; theme via `useThemedStyles`/tokens; `Alert` from `@/lib/alert`.
  Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
