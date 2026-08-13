# Free/Pro gating + Publish Pro-wall — Slice B — Design

**Status:** Approved (brainstorming, 2026-08-13). Second slice of the billing work. Gates paid features on
an **active managed entitlement** ("Pro"), enforced **server + client**, with entitlement operator-granted
today (via the existing admin API) and a payment rail later (Slice C, rails TBD). Builds on Slice A's
metering/entitlement spine.

## "Pro" definition

**Pro = `resolve_managed_access(conn, account_id)` grants** — i.e. an **active entitlement** (status
`active`, period covers now) **OR** the staff allowlist (dogfood override, so internal users aren't
walled). "Free" = neither (BYOK / anonymous / no plan). One helper, `billing/access.py::is_pro`, is the
single source of truth. **Deliberate consequence (user-chosen):** a BYOK user (self-funds tokens) is
"Free" → cannot download export files, only read in-app + copy text. This is aggressive but reversible —
it's the one `is_pro` function.

## Enforcement (server + client, non-negotiable)

A client-only wall on a paid feature is trivially bypassed, so **every gate is enforced server-side**; the
client mirrors it for UX (walls, "upgrade" CTAs) reading a status endpoint.

### The three gates
1. **Export Pro-wall.** The compiler export (`POST /export/jobs`) refuses with **402 Payment Required**
   unless Pro. Client `PublishPanel`: Free keeps **Add-to-Library (in-app reader) + text/MD copy** free;
   the **EPUB/PDF download** controls become an "Upgrade to Pro" wall.
2. **Projects cap.** `POST /projects` refuses with 402 when Free and the account already owns ≥
   `FREE_MAX_PROJECTS`. Client walls the "New project" action at the cap.
3. **Generations cap.** The 3 trust generate submits (`.../topics/{id}/generate`,
   `.../artifacts/{id}/versions/generate`, `.../suggest-toc`) refuse with 402 when Free and the account's
   generations-in-window ≥ `FREE_MAX_GENERATIONS`. Client surfaces the 402 as "limit reached → upgrade".

### Counting (from existing data — no new tables)
- **Projects:** `SELECT count(*) FROM project WHERE owner_account_id = $1`.
- **Generations (in window):** `count(topic_version) + count(artifact_version) WHERE created_by_sub = $sub
  AND created_at >= now() - FREE_GEN_WINDOW`. Covers BYOK + managed (both persist versions). Regenerations
  count (each new version); ephemeral suggest-TOC isn't persisted so it's uncounted — acceptable proxy.
  (The standalone `/generate` lesson path isn't per-account-persisted at MVP, so it's outside the quota —
  the quota governs the SME/trust spine.)

### Config (tunable, sensible defaults)
`FREE_MAX_PROJECTS` (default 2), `FREE_MAX_GENERATIONS` (default 20), `FREE_GEN_WINDOW_DAYS` (default 30) —
`pydantic-settings`, per ADR-005 policy-in-config. Pro = unlimited (the caps don't apply).

## The export-auth wrinkle (must handle)

`POST /export/jobs` has **no auth dependency today** (rate-limit only) — so the anonymous/public demo can
export. Adding a Pro gate requires an authenticated principal. **Constraint:** the gate must NOT break the
public demo. Approach: make the principal **optional** on `submit_export` (`Depends(get_optional_principal)`
or equivalent) and apply the Pro check **only for authenticated app requests**; the read-only demo
(`IS_DEMO`) does not export user books, and any anonymous export path stays as-is (or is separately
disallowed). T2 confirms the demo/anonymous export flow is unaffected before landing the gate. If the
export endpoint has no optional-principal dependency available, add one (verify against `auth/deps`).

## Client status contract

**New `GET /api/v1/billing/plan-status`** (so the client renders walls/limits proactively, not only by
catching 402s): `{ is_pro: bool, caps: { max_projects, max_generations, gen_window_days }, usage: {
projects: int, generations: int }, at_project_cap: bool, at_generation_cap: bool }`. Read via a
`useBillingPlan` hook; drives the PublishPanel wall, the New-project wall, and a limits/upgrade surface.
(Distinct from Slice A's `managed-status`, which is the token-cost meter.)

## Architecture

### Backend
- **`billing/access.py::is_pro(conn, *, account_id) -> bool`** — `resolve_managed_access(...) is not None`
  (active entitlement or staff), truthy.
- **`billing/quota.py` (new)** — `count_projects(conn, account_id)`, `count_generations(conn, sub, since)`,
  and `plan_status(conn, *, account_id, sub) -> PlanStatus` bundling is_pro + caps (from settings) +
  counts + the two `at_*_cap` booleans.
- **`GET /billing/plan-status`** in `billing/router.py` (authenticated) → `PlanStatusView`.
- **Gate helpers** raising `HTTPException(402, "…upgrade to Pro…")`: reuse in the 3 gate sites.
  - `export/router.py::submit_export`: optional-principal Pro check (see wrinkle).
  - `trust/router.py::create_project`: `if not is_pro and count_projects ≥ cap → 402`.
  - the 3 trust generate submits: `if not is_pro and count_generations(window) ≥ cap → 402`. (Add the check
    beside the existing owner/eligibility guards; managed-eligibility is unchanged.)

### Mobile
- **`billingClient.getPlanStatus(token): Promise<PlanStatus>`** + `useBillingPlan()` hook (mirror
  `useManagedStatus`; non-critical — a fetch failure ⇒ treat as Pro-unknown but do NOT wall, to avoid
  falsely blocking; server remains the true gate).
- **`PublishPanel`** (`[projectId].tsx`): when `!is_pro`, replace the EPUB/PDF download buttons with an
  "Upgrade to Pro" control (→ a plan/upgrade surface); keep Add-to-Library + text/MD. On a 402 from an
  export submit, show the upgrade prompt (belt-and-suspenders).
- **New project + generate:** when `at_project_cap` / `at_generation_cap` (Free), disable the action with a
  "Free limit reached — upgrade" hint; also handle a 402 response (the authoritative gate) with the same
  prompt.
- **Plan/limits surface:** a small section (in Settings or the existing `/usage` screen) showing Free caps
  + current usage + an "Upgrade to Pro" CTA. Since there's no payment rail yet, "Upgrade" explains the
  operator-grant path (or links to contact) — no checkout. (Rails = Slice C.)

## Testing

- **Backend:** `is_pro` true for active entitlement + staff, false otherwise. `plan-status` returns correct
  caps/counts/at_*_cap for Free vs Pro. **Gate tests:** a Free account at the project cap → `POST /projects`
  402; under cap → 201; Pro → always 201. Free at the generation cap → each of the 3 trust submits 402;
  under → 202; Pro → 202. Export: Free authenticated → `POST /export/jobs` 402; Pro → 202; **the
  anonymous/demo export path is unaffected** (explicit test). Caps come from config (monkeypatch settings).
- **Mobile:** `useBillingPlan` returns the status; a fetch failure does NOT wall (renders as unknown/allow,
  server enforces). PublishPanel shows the download buttons for Pro, the upgrade wall for Free (+ keeps
  Add-to-Library/text). New-project + generate disabled-at-cap with the hint; a 402 shows the upgrade
  prompt. No color-literal asserts.

## Decomposition (SDD)

- **T1 — backend foundation:** `is_pro` + `billing/quota.py` (counts + `plan_status`) + `GET
  /billing/plan-status` + the config caps + `PlanStatusView`. Tests.
- **T2 — backend enforcement:** the 3 server gates (export 402 incl. the optional-principal wrinkle +
  demo-safe; project-create 402; generation 402 on the 3 trust submits). Tests incl. the demo-unaffected
  export test.
- **T3 — client export Pro-wall:** `getPlanStatus` + `useBillingPlan`; `PublishPanel` wall (Free →
  Add-to-Library/text only, download → upgrade); 402 handling on export. Tests.
- **T4 — client quota walls + limits surface:** New-project + generate disabled-at-cap + 402 handling; the
  plan/limits + upgrade surface. Tests.

## Rollout

**Backend refresh** (new gates + endpoint) **+ web deploy** (the walls). **No migration** (entitlement/
usage/version tables exist). ⚠ **Response-behavior change:** authenticated export + project-create +
generate can now return 402 for Free users — ship backend + web together so the client handles it. **Grant
yourself Pro** (via `PUT /admin/users/{sub}/entitlement`, a `managed_*` plan) to keep dogfooding unwalled;
the staff allowlist also keeps internal users Pro.

## Scope boundary — public Open-Library publishing is intentionally FREE (decided 2026-08-13)

The Pro-wall gates **private downloads** of the compiled EPUB/PDF (the Publish-panel EPUB/PDF download +
both `/export` handlers). It does **NOT** gate **`POST /library/{book_id}/publish`** (→ the public Open
Library, ADR-027/028) or the published-artifact download — those stay **free by design**. Rationale:
publishing gives the book to the **public community catalog** (a different value exchange than a private
copy) and is the Open-Library moat we want to encourage; walling it behind Pro would suppress it. **Known,
accepted consequence:** a Free user *can* obtain the compiled EPUB/PDF by publishing it publicly (thereby
giving the content to the catalog). This is the intended boundary, not a bypass to close. (Surfaced by the
whole-branch review; user decision: keep public-publish free + document it here.)

## Out of scope (later)

- Payment rail (Slice C — Stripe web vs RevenueCat mobile). A real checkout / upgrade flow (this slice's
  "Upgrade" explains the operator-grant, no payment). Changes to the managed-token allowance model. The
  standalone `/generate` lesson quota.

## Global constraints

- **Server is the authoritative gate** — the client wall/hint is UX only; every gate is enforced server-side
  (402). A client billing-fetch failure must NOT wall (fail-open on the client; the server still refuses).
- **Do not break the anonymous/public demo export** — the export gate applies only to authenticated app
  requests; T2 verifies the demo path.
- **`is_pro` is the single source of truth** (active entitlement OR staff); no duplicated Pro logic.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` +
  `npx eslint .`. No color-literal asserts; theme via `useThemedStyles`/tokens; `Alert` from `@/lib/alert`.
  Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
