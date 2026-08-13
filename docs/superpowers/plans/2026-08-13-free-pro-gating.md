# Free/Pro gating + Publish Pro-wall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate paid features on an active managed entitlement ("Pro"), enforced server + client: an export Pro-wall, a Free projects cap, and a Free generations cap — with a `plan-status` endpoint so the client renders walls proactively.

**Architecture:** `is_pro` (active entitlement OR staff) is the single truth. A new `billing/quota.py` counts projects + generations from existing tables and bundles a `PlanStatus`. Three server gates return 402 for Free-over-cap; the mobile client reads `GET /billing/plan-status`, walls the UI, and fails open on a billing-fetch error (server stays authoritative).

**Tech Stack:** FastAPI + asyncpg (backend); React Native (Expo) (mobile); pytest; Jest + RNTL.

## Global Constraints

- **Server is the authoritative gate.** Every gate returns 402 server-side; the client wall is UX only and MUST fail open (a billing-fetch failure never walls).
- **Do not break the anonymous/public demo export.** The `/export/jobs` gate applies only to authenticated app requests (optional principal); T2 verifies the demo path.
- **`is_pro` = `resolve_managed_access(...) is not None`** (active entitlement OR staff allowlist) — single source of truth, no duplicated Pro logic.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. No color-literal asserts; theme via `useThemedStyles`/tokens; `Alert` from `@/lib/alert`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `optional_user(request) -> Principal | None` in `backend/src/auth/deps.py`. `create_project` (trust/router.py:88) has `principal` + `conn` + `account.id`. `project` table owner col = `owner_account_id`. `topic_version`/`artifact_version` carry `created_by_sub` + `created_at`. `resolve_managed_access(conn, account_id, ...)` in `billing/access.py:45`.

---

### Task 1: Backend foundation — `is_pro`, `quota.py`, `plan-status`, config caps

**Files:**
- Modify: `backend/config.py` (Free caps), `backend/src/billing/access.py` (`is_pro`), `backend/src/billing/router.py` (`GET /plan-status`), `backend/src/billing/schemas.py` (or wherever billing schemas live — `PlanStatusView`)
- Create: `backend/src/billing/quota.py`
- Test: `backend/tests/test_billing_quota.py` (new)

**Interfaces:**
- Consumes: `resolve_managed_access`, `entitlement_repo`, `accounts_repo`, `settings`.
- Produces: `is_pro(conn, *, account_id) -> bool`; `quota.plan_status(conn, *, account_id, sub) -> PlanStatus`; `GET /api/v1/billing/plan-status -> PlanStatusView`.

- [ ] **Step 1: Config caps** in `backend/config.py` (in `Settings`):
```python
free_max_projects: int = Field(default=2, ge=0)
free_max_generations: int = Field(default=20, ge=0)
free_gen_window_days: int = Field(default=30, ge=1)
```

- [ ] **Step 2: `is_pro`** in `billing/access.py`:
```python
async def is_pro(conn, *, account_id) -> bool:
    """Pro = an active managed entitlement OR the staff allowlist — the single gate
    for paid features. Reuses resolve_managed_access (entitlement or staff)."""
    access = await resolve_managed_access(conn, account_id=account_id)  # match its real signature
    return access is not None
```
(Read `resolve_managed_access`'s exact signature/return — it may need `principal`/provider; adapt so `is_pro` returns True iff the account has entitlement-or-staff access, independent of a specific provider. If `resolve_managed_access` is provider-scoped, add a small provider-agnostic `has_active_entitlement(conn, account_id)` = active entitlement, OR staff, instead.)

- [ ] **Step 3: `billing/quota.py`** (new):
```python
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from backend.config import settings
from backend.src.billing.access import is_pro

@dataclass(frozen=True)
class PlanStatus:
    is_pro: bool
    max_projects: int
    max_generations: int
    gen_window_days: int
    projects: int
    generations: int
    at_project_cap: bool
    at_generation_cap: bool

async def count_projects(conn, account_id) -> int:
    return await conn.fetchval("SELECT count(*) FROM project WHERE owner_account_id = $1", account_id)

async def count_generations(conn, sub, since) -> int:
    return await conn.fetchval(
        "SELECT (SELECT count(*) FROM topic_version WHERE created_by_sub = $1 AND created_at >= $2)"
        "     + (SELECT count(*) FROM artifact_version WHERE created_by_sub = $1 AND created_at >= $2)",
        sub, since,
    )

async def plan_status(conn, *, account_id, sub) -> PlanStatus:
    pro = await is_pro(conn, account_id=account_id)
    since = datetime.now(UTC) - timedelta(days=settings.free_gen_window_days)
    projects = await count_projects(conn, account_id)
    generations = await count_generations(conn, sub, since)
    return PlanStatus(
        is_pro=pro,
        max_projects=settings.free_max_projects,
        max_generations=settings.free_max_generations,
        gen_window_days=settings.free_gen_window_days,
        projects=projects, generations=generations,
        at_project_cap=(not pro) and projects >= settings.free_max_projects,
        at_generation_cap=(not pro) and generations >= settings.free_max_generations,
    )
```

- [ ] **Step 4: `PlanStatusView` schema + `GET /billing/plan-status`.** Add `PlanStatusView` (fields mirroring `PlanStatus`) where billing response schemas live (`billing/router.py` imports them from — match the `ManagedStatusView` location). Endpoint in `billing/router.py`:
```python
@router.get("/plan-status", response_model=PlanStatusView)
async def get_plan_status(principal: Principal = Depends(require_active_user), conn: asyncpg.Connection = Depends(get_conn)) -> PlanStatusView:
    account = await accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
    ps = await quota.plan_status(conn, account_id=account.id, sub=principal.sub)
    return PlanStatusView(is_pro=ps.is_pro, caps={"max_projects": ps.max_projects, "max_generations": ps.max_generations, "gen_window_days": ps.gen_window_days}, usage={"projects": ps.projects, "generations": ps.generations}, at_project_cap=ps.at_project_cap, at_generation_cap=ps.at_generation_cap)
```
(Shape the `PlanStatusView` to match the client contract in the spec: `{is_pro, caps:{max_projects,max_generations,gen_window_days}, usage:{projects,generations}, at_project_cap, at_generation_cap}`.)

- [ ] **Step 5: Tests** (`test_billing_quota.py`, DB-gated, mirror an existing billing test's fixtures): `is_pro` True for an account with an active entitlement + True for a staff-allowlisted sub + False otherwise; `count_projects`/`count_generations` correct; `plan_status` computes `at_*_cap` correctly for Free (over/under) and Pro (never at cap); `GET /plan-status` returns the right shape for Free vs Pro. Monkeypatch `settings.free_max_*` to small values.

- [ ] **Step 6: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_billing_quota.py -q`. Commit:
```bash
git add backend/config.py backend/src/billing/access.py backend/src/billing/quota.py backend/src/billing/router.py backend/src/billing/schemas.py backend/tests/test_billing_quota.py
git commit -m "feat(billing): is_pro + quota counts + GET /plan-status + Free-cap config"
```

---

### Task 2: Backend enforcement — the 3 gates (402)

**Files:**
- Modify: `backend/src/export/router.py` (export 402, optional principal), `backend/src/trust/router.py` (project-create 402 + generation 402 on the 3 submits)
- Test: `backend/tests/test_free_pro_gates.py` (new); may extend export/trust router tests

**Interfaces:**
- Consumes: `is_pro`, `quota.count_projects`/`count_generations`, `settings`, `optional_user`.
- Produces: 402 responses for Free-over-cap; no change for Pro.

- [ ] **Step 1: A shared gate helper** (in `billing/quota.py` or a small `billing/gates.py`):
```python
def _pro_required(detail: str) -> HTTPException:
    return HTTPException(status_code=402, detail=detail)  # 402 Payment Required
```
Use a consistent `detail` the client can key on (e.g. `"Free plan limit reached — upgrade to Pro."` variants per gate).

- [ ] **Step 2: Export gate** in `export/router.py::submit_export`. Add `principal: Principal | None = Depends(optional_user)` + `conn` (add a DB dependency if absent — verify the export router has a conn dep; if not, acquire from the pool). After the cheap format/size validation, **if there is an authenticated principal and they are not Pro → 402**; anonymous requests are NOT gated (demo-safe):
```python
if principal is not None:
    account = await accounts_repo.get_or_create_account(conn, idp_sub=principal.sub, email=principal.email)
    if not await is_pro(conn, account_id=account.id):
        raise _pro_required("Exporting a book file is a Pro feature. Read it in-app or copy the text, or upgrade to Pro.")
```
**Verify the anonymous/demo export still works** (no principal ⇒ no gate). Read the export router's existing deps to wire `conn`/`accounts_repo` cleanly (it may need a new `get_conn` dependency — confirm the app has DB configured in the export context; if export runs without DB in the demo, guard the gate on `db configured AND principal`).

- [ ] **Step 3: Project-create gate** in `trust/router.py::create_project`, right after `account = await _account(...)`:
```python
if not await is_pro(conn, account_id=account.id):
    if await quota.count_projects(conn, account.id) >= settings.free_max_projects:
        raise _pro_required("Free plan is limited to {n} projects — upgrade to Pro for more.".format(n=settings.free_max_projects))
```

- [ ] **Step 4: Generation gate** on the 3 trust submit endpoints (`generate_topic_version`, `generate_version`, `suggest_project_toc`) — beside the existing owner/eligibility guards, before enqueue:
```python
if not await is_pro(conn, account_id=account.id):
    since = datetime.now(UTC) - timedelta(days=settings.free_gen_window_days)
    if await quota.count_generations(conn, principal.sub, since) >= settings.free_max_generations:
        raise _pro_required("Free plan is limited to {n} generations per {d} days — upgrade to Pro.".format(n=settings.free_max_generations, d=settings.free_gen_window_days))
```
(Resolve `account` the same way each handler already does. Place the check so a Free-capped user is refused BEFORE any job/envelope is created.)

- [ ] **Step 5: Tests** (`test_free_pro_gates.py`, DB-gated): Free at project cap → `POST /projects` 402; under → 201; Pro → 201 regardless. Free at gen cap → each of the 3 trust submits 402; under → 202; Pro → 202. Export: authenticated Free → `POST /export/jobs` 402; authenticated Pro → 202; **anonymous → NOT 402 (demo unaffected)** — an explicit test. Monkeypatch `settings.free_max_*` low; grant/withhold entitlement via `entitlement_repo`/staff-allowlist monkeypatch.

- [ ] **Step 6: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_free_pro_gates.py tests/test_trust_router.py -q`. Commit:
```bash
git add backend/src/export/router.py backend/src/trust/router.py backend/tests/test_free_pro_gates.py
git commit -m "feat(billing): enforce Free/Pro gates (402) — export wall, projects cap, generations cap"
```

---

### Task 3: Client — plan-status hook + export Pro-wall

**Files:**
- Modify: `mobile/src/api/billingClient.ts` (`getPlanStatus` + types), `mobile/app/trust/[projectId].tsx` (PublishPanel wall)
- Create: `mobile/src/hooks/useBillingPlan.ts`
- Test: `mobile/__tests__/hooks/useBillingPlan.test.tsx`, and the PublishPanel/TrustProjectDetail publish tests

**Interfaces:**
- Produces: `getPlanStatus(token): Promise<PlanStatus>` (`{ is_pro; caps; usage; at_project_cap; at_generation_cap }`); `useBillingPlan(): { plan: PlanStatus | null; loading }`.

- [ ] **Step 1: Client + hook.** `billingClient.getPlanStatus` (mirror `getManagedStatus`, GET `/api/v1/billing/plan-status`). `useBillingPlan` (mirror `useManagedStatus`): fetch on focus; **on failure return null** (do NOT wall — fail open). Test: returns plan when signed-in, null when signed-out, null (no throw) on a rejected fetch.

- [ ] **Step 2: PublishPanel Pro-wall.** In `[projectId].tsx`'s `PublishPanel`, read the plan (thread it from the screen via `useBillingPlan`). When `plan && !plan.is_pro`: replace the **Download EPUB / Download PDF** controls (`onPublishDownload`/`onDownloadAsset`) with an **"Upgrade to Pro to download"** control (→ navigate to the plan/limits surface, T4, or Settings) — but keep **Add to Library** and the **text/MD copy** available. When `plan?.is_pro` OR `plan == null` (unknown/fail-open) → show the download controls as today (server still enforces on 402). Also: if a download submit returns a 402 (`ApiError` status 402), show the upgrade prompt (belt-and-suspenders).

- [ ] **Step 3: Tests** — PublishPanel with `useBillingPlan` mocked Pro → download buttons present; mocked Free → download replaced by the upgrade control, Add-to-Library + text still present; null plan → download shown (fail-open). A 402 on an export submit → upgrade prompt. No color-literal asserts.

- [ ] **Step 4: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Commit:
```bash
git add mobile/src/api/billingClient.ts mobile/src/hooks/useBillingPlan.ts mobile/app/trust/[projectId].tsx mobile/__tests__
git commit -m "feat(billing): client export Pro-wall + useBillingPlan (fail-open)"
```

---

### Task 4: Client — quota walls + limits/upgrade surface

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx` (generate at-cap + 402), the New-project surface (`mobile/app/trust/new.tsx` or wherever projects are created), and a limits surface (Settings or `mobile/app/usage.tsx`)
- Test: the relevant screen tests

**Interfaces:**
- Consumes: `useBillingPlan` (Task 3).

- [ ] **Step 1: New-project cap.** On the New-project action/screen, when `plan && !plan.is_pro && plan.at_project_cap` → disable "Create" with a "Free limit reached — upgrade to Pro" hint. On a 402 from `POST /projects` → show the upgrade prompt (authoritative). Fail-open when `plan == null`.

- [ ] **Step 2: Generation cap.** On the per-topic / whole-book / suggest generate actions, when `plan && !plan.is_pro && plan.at_generation_cap` → disable with the "Free limit reached — upgrade" hint. On a 402 from any generate submit → the upgrade prompt (reuse the existing catch — `ApiError.status === 402` → upgrade message, distinct from other errors). Fail-open when `plan == null`.

- [ ] **Step 3: Limits / upgrade surface.** A small section (in `app/usage.tsx` or Settings) showing: plan (Free/Pro), the caps + current usage (`plan.usage.projects / caps.max_projects`, `plan.usage.generations / caps.max_generations`), and an **"Upgrade to Pro"** CTA. Since there is no payment rail yet, the CTA explains the operator-grant path (or a contact link) — NO checkout. Guard for `plan == null` (hide/loading).

- [ ] **Step 4: Tests** — new-project disabled-at-cap + 402 prompt; generate disabled-at-cap + 402 prompt; the limits surface renders caps/usage for Free and "Pro" for a Pro plan; fail-open (null plan) doesn't disable anything. No color-literal asserts.

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Commit:
```bash
git add mobile/app/trust mobile/app/usage.tsx mobile/__tests__
git commit -m "feat(billing): Free quota walls (projects + generations) + limits/upgrade surface"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_billing_quota.py tests/test_free_pro_gates.py tests/test_trust_router.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] **Security/robustness:** every gate is enforced SERVER-side (402) — grep confirms is_pro/count checks at all 3 gate sites; the client fails open (a billing-fetch failure never walls). The anonymous/demo export path is NOT gated (test).
- [ ] **`is_pro` single source of truth** — no duplicated Pro logic across the gates.
- [ ] **Deploy:** backend refresh + web deploy **together** (authenticated export/create/generate can now 402). No migration. Grant yourself a `managed_*` entitlement (`PUT /admin/users/{sub}/entitlement`) or rely on the staff allowlist to stay unwalled.

## Out of scope

- Payment rail (Slice C). A real checkout. The standalone `/generate` lesson quota. Changes to the managed-token allowance model.
