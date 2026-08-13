# Tester full-access (keyless Pro) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a super-admin grant chosen testers full feature access + keyless generation on our managed Anthropic key — by wiring the managed vars into prod compose (A′) and adding a console Grant/Revoke plan UI (C).

**Architecture:** A′ adds 7 managed env vars to both `api` + `celery-worker` env blocks in `docker-compose.demo.yml` (the `Settings` fields already exist; this is pure wiring). C adds a super-admin `GET /api/v1/admin/plans` (plan catalog for the picker) + a "Plan" section on `mobile/app/admin/[sub].tsx` that grants `managed_unlimited` / `managed_basic` and revokes, via the already-live `PUT /admin/users/{sub}/entitlement`.

**Tech Stack:** Docker Compose; FastAPI + asyncpg (backend); React Native (Expo), `useThemedStyles` (mobile); pytest; Jest + RNTL.

## Global Constraints

- ADR-001 key discipline: `MANAGED_ANTHROPIC_API_KEY` is a live credential — never logged/DB'd/in a traceback. (A′ only names it in compose; no code reads it into a log.)
- Super-admin gating: `GET /admin/plans` + grant/revoke require `require_super_admin` (config-derived, never a token claim). The `[sub].tsx` screen already gates on `is_super_admin`.
- No color-literal asserts; theme via `useThemedStyles`/tokens from `@/constants/theme`; `Alert` from `@/lib/alert`.
- Backend `ruff check .` **and** `ruff format --check .`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `Settings` fields already exist (`config.py`): `managed_anthropic_api_key`, `managed_plan_emails`, `managed_plan_subs`, `managed_account_spend_ceiling_micros`, `free_max_projects/generations`, `free_gen_window_days`. Router prefix `/api/v1/admin`, every route `Depends(require_super_admin)`. `plans.plan_ids()` + `plans.get_plan(id)` (no `all_plans`); `Plan = {id, display, allowance_micros, managed_providers: frozenset[str]}`; ids `managed_basic` / `managed_unlimited` (allowance 0). `GrantEntitlementRequest = {plan_id, status="active", period_days: int|None}`; `EntitlementView = {plan_id, status, period_start, period_end}` — both in `backend/src/accounts/schemas.py`. `ENTITLEMENT_STATUSES = ("active","past_due","canceled")`. adminClient at `mobile/src/api/adminClient.ts` (`adminFetch<T>(path, token, options?) -> T|null`, calls fn(token, sub, ...)). `[sub].tsx` uses `makeStyles(c: Palette)` + `styles.section`/`styles.card`/`styles.muted`/`styles.action`/`styles.actionText`, `Alert` from `@/lib/alert`, token via `useAuth().accessToken`.

---

### Task 1: A′ — wire managed vars into prod compose

**Files:**
- Modify: `docker-compose.demo.yml` (the `api` service `environment:` block ~L52, and the `celery-worker` block ~L129)

**Interfaces:**
- Produces: both containers receive `MANAGED_ANTHROPIC_API_KEY`, `MANAGED_PLAN_EMAILS`, `MANAGED_PLAN_SUBS`, `MANAGED_ACCOUNT_SPEND_CEILING_MICROS`, `FREE_MAX_PROJECTS`, `FREE_MAX_GENERATIONS`, `FREE_GEN_WINDOW_DAYS` from the compose env (empty/default when unset in `.env.demo`).

- [ ] **Step 1: Add the block to the `api` service `environment:`** (after the `SUPER_ADMIN_SUBS` line, before the Open-Library `ARTIFACT_STORE_DIR` comment):

```yaml
      # ── Managed billing (ADR-005 D6) — grant testers Pro + keyless managed gen ──
      # MANAGED_ANTHROPIC_API_KEY is OUR provider credential (ADR-001 discipline);
      # empty ⇒ managed off (testers fall back to BYOK). MANAGED_PLAN_EMAILS/SUBS =
      # the staff-allowlist cohort ⇒ Pro. The spend ceiling backstops even an
      # "unlimited" plan (0 ⇒ uncapped). FREE_* tune the Free caps without a rebuild.
      MANAGED_ANTHROPIC_API_KEY: ${MANAGED_ANTHROPIC_API_KEY:-}
      MANAGED_PLAN_EMAILS: ${MANAGED_PLAN_EMAILS:-}
      MANAGED_PLAN_SUBS: ${MANAGED_PLAN_SUBS:-}
      MANAGED_ACCOUNT_SPEND_CEILING_MICROS: ${MANAGED_ACCOUNT_SPEND_CEILING_MICROS:-0}
      FREE_MAX_PROJECTS: ${FREE_MAX_PROJECTS:-2}
      FREE_MAX_GENERATIONS: ${FREE_MAX_GENERATIONS:-20}
      FREE_GEN_WINDOW_DAYS: ${FREE_GEN_WINDOW_DAYS:-30}
```

- [ ] **Step 2: Add the identical block to the `celery-worker` service `environment:`** (after its `SUPER_ADMIN_SUBS` line). The worker resolves managed access at generation time, so it needs the same vars.

- [ ] **Step 3: Verify the compose parses and both services carry the vars.** Run:

```bash
docker compose -f docker-compose.demo.yml config 2>/dev/null | grep -c "MANAGED_ANTHROPIC_API_KEY"
```

Expected: `2` (once per service). If `docker` is unavailable in the workspace, instead assert both `environment:` blocks contain all 7 keys by inspection (`grep -n "MANAGED_ANTHROPIC_API_KEY\|MANAGED_PLAN_EMAILS\|MANAGED_ACCOUNT_SPEND_CEILING_MICROS\|FREE_MAX_PROJECTS" docker-compose.demo.yml` → 7 lines × in-both-blocks; the block appears twice).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.demo.yml
git commit -m "chore(deploy): wire managed billing vars into demo compose (api + worker)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: C backend — `GET /api/v1/admin/plans`

**Files:**
- Modify: `backend/src/accounts/schemas.py` (add `PlanSummary`)
- Modify: `backend/src/admin/router.py` (add the route; import `plans` + `PlanSummary`)
- Test: `backend/tests/test_admin_api.py` (add the plans cases)

**Interfaces:**
- Produces: `GET /api/v1/admin/plans -> list[PlanSummary]` where `PlanSummary = { id: str, display: str, allowance_micros: int, managed_providers: list[str] }` (super-admin only).

- [ ] **Step 1: Write the failing test** in `backend/tests/test_admin_api.py`. The file provides one fixture, `admin_client` (a `TestClient` with `require_super_admin` overridden to pass), and module constants `ADMIN` (= `/api/v1/admin`). Mirror an existing `/users` test:

```python
def test_admin_plans_lists_catalog(admin_client):
    r = admin_client.get(f"{ADMIN}/plans")
    assert r.status_code == 200
    plans = {p["id"]: p for p in r.json()}
    assert plans["managed_unlimited"]["allowance_micros"] == 0
    assert "anthropic" in plans["managed_basic"]["managed_providers"]
    assert isinstance(plans["managed_basic"]["managed_providers"], list)
```

Do NOT add a per-route 403 test: `/admin/plans` uses the identical `Depends(require_super_admin)` as every other admin route, and that dependency's 403 behaviour is already covered by `test_super_admin.py::test_require_super_admin_forbids_ordinary_user`. A duplicate would be a test-hygiene defect.

- [ ] **Step 2: Run it — FAIL** (`404`, route missing).

Run: `cd backend && python -m pytest tests/test_admin_api.py -q -k plans`

- [ ] **Step 3: Add `PlanSummary`** to `backend/src/accounts/schemas.py` (near `EntitlementView`):

```python
class PlanSummary(BaseModel):
    """A managed plan from the registry (admin picker). Not an account's entitlement."""

    id: str
    display: str
    allowance_micros: int
    managed_providers: list[str]
```

- [ ] **Step 4: Add the route** to `backend/src/admin/router.py`. Add `from backend.src.billing import plans` to the imports and `PlanSummary` to the `accounts.schemas` import group, then:

```python
@router.get("/plans", response_model=list[PlanSummary])
async def list_plans(_admin: Principal = Depends(require_super_admin)) -> list[PlanSummary]:
    """The managed-plan catalog for the admin grant picker (super-admin; read-only)."""
    out: list[PlanSummary] = []
    for pid in sorted(plans.plan_ids()):
        plan = plans.get_plan(pid)
        if plan is None:
            continue
        out.append(
            PlanSummary(
                id=plan.id,
                display=plan.display,
                allowance_micros=plan.allowance_micros,
                managed_providers=sorted(plan.managed_providers),
            )
        )
    return out
```

- [ ] **Step 5: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_admin_api.py -q`. Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/accounts/schemas.py backend/src/admin/router.py backend/tests/test_admin_api.py
git commit -m "feat(admin): GET /admin/plans — managed-plan catalog for the grant picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: C mobile — Plan section on the admin user screen

**Files:**
- Modify: `mobile/src/api/adminClient.ts` (add `PlanSummary`, `EntitlementView` types + `listPlans` / `getEntitlement` / `grantEntitlement` / `revokeEntitlement`)
- Modify: `mobile/app/admin/[sub].tsx` (fetch plans + entitlement; render the "Plan" section)
- Test: `mobile/__tests__/api/adminClient.test.ts` (client cases) + a `[sub].tsx` screen test (extend `mobile/__tests__/screens/Admin.test.tsx` if it renders the `[sub]` screen, else add `mobile/__tests__/screens/AdminUser.test.tsx`)

**Interfaces:**
- Consumes: `adminFetch`, `listPlans(token)`, `getEntitlement(token, sub)`, `grantEntitlement(token, sub, planId)`, `revokeEntitlement(token, sub, planId)`; `useAuth().accessToken`; `getUser`.

- [ ] **Step 1: Add the client methods + types** to `mobile/src/api/adminClient.ts`:

```ts
export interface PlanSummary {
  id: string;
  display: string;
  allowance_micros: number;
  managed_providers: string[];
}

export interface EntitlementView {
  plan_id: string;
  status: string;
  period_start: string;
  period_end: string;
}

export async function listPlans(token: string): Promise<PlanSummary[]> {
  return (await adminFetch<PlanSummary[]>(`/plans`, token)) as PlanSummary[];
}

export async function getEntitlement(token: string, sub: string): Promise<EntitlementView | null> {
  return adminFetch<EntitlementView>(`/users/${encodeURIComponent(sub)}/entitlement`, token);
}

export async function grantEntitlement(
  token: string,
  sub: string,
  planId: string,
): Promise<EntitlementView> {
  return (await adminFetch<EntitlementView>(`/users/${encodeURIComponent(sub)}/entitlement`, token, {
    method: "PUT",
    body: JSON.stringify({ plan_id: planId, status: "active" }),
  })) as EntitlementView;
}

export async function revokeEntitlement(
  token: string,
  sub: string,
  planId: string,
): Promise<EntitlementView> {
  return (await adminFetch<EntitlementView>(`/users/${encodeURIComponent(sub)}/entitlement`, token, {
    method: "PUT",
    body: JSON.stringify({ plan_id: planId, status: "canceled" }),
  })) as EntitlementView;
}
```

- [ ] **Step 2: Write the failing client test** in `mobile/__tests__/api/adminClient.test.ts` (mirror the existing fetch-mock pattern in that file):
  - `listPlans("tok")` → GETs `…/api/v1/admin/plans` with `Authorization: Bearer tok`; returns the parsed array.
  - `grantEntitlement("tok","sub-1","managed_unlimited")` → PUTs `…/users/sub-1/entitlement` with body `{"plan_id":"managed_unlimited","status":"active"}`.
  - `revokeEntitlement("tok","sub-1","managed_unlimited")` → PUT body `{"plan_id":"managed_unlimited","status":"canceled"}`.

- [ ] **Step 3: Run it — FAIL** (methods undefined). `cd mobile && npx jest adminClient`.

- [ ] **Step 4: Write the failing screen test** — extend `Admin.test.tsx` if it renders `app/admin/[sub].tsx`; otherwise add `mobile/__tests__/screens/AdminUser.test.tsx`. Mock `@/api/adminClient` (`getUser` → a detail with `credentials: []`, `devices: []`; `listPlans` → `[{id:"managed_unlimited",display:"Managed Unlimited",allowance_micros:0,managed_providers:["anthropic"]}, {id:"managed_basic",display:"Managed Basic",allowance_micros:5000000,managed_providers:["anthropic"]}]`), `@/auth/AuthProvider` (`accessToken:"tok"`, `isSuperAdmin`/`is_super_admin` truthy), `expo-router` (`useLocalSearchParams` → `{ sub: "sub-1" }`). Assert:
  - `getEntitlement` → `null`: the Plan section shows "No managed plan — Free" and a "Managed Unlimited" grant control; no Revoke.
  - pressing "Managed Unlimited" calls `grantEntitlement("tok","sub-1","managed_unlimited")`.
  - `getEntitlement` → `{plan_id:"managed_unlimited",status:"active",period_start,period_end}`: the section shows "Managed Unlimited" + "active" and a "Revoke" control; pressing it calls `revokeEntitlement("tok","sub-1","managed_unlimited")`.
  No color-literal asserts.

- [ ] **Step 5: Run it — FAIL** (no Plan section). `cd mobile && npx jest -t "Plan"` (or the new file).

- [ ] **Step 6: Implement the Plan section in `mobile/app/admin/[sub].tsx`.**
  - Import `listPlans, getEntitlement, grantEntitlement, revokeEntitlement, type PlanSummary, type EntitlementView` from `@/api/adminClient`.
  - Add state: `const [plans, setPlans] = useState<PlanSummary[]>([]);` and `const [entitlement, setEntitlement] = useState<EntitlementView | null>(null);`.
  - In the existing load callback (where `getUser` is fetched), also fetch `listPlans(accessToken)` and `getEntitlement(accessToken, sub)` and set them. **Fail-soft:** wrap the plans/entitlement fetch so a failure leaves them empty/null and does NOT break the user load (the section just can't grant).
  - `onGrant(planId)`: `setBusy(true)` → `const ent = await grantEntitlement(accessToken, sub, planId)` → `setEntitlement(ent)` → `Alert.alert("Plan granted", planDisplay(planId))`; on error `Alert.alert("Couldn't grant", …)`; `finally setBusy(false)`.
  - `onRevoke()`: guard `entitlement`; `const ent = await revokeEntitlement(accessToken, sub, entitlement.plan_id)` → `setEntitlement(ent)`; error/finally like grant.
  - `planDisplay(id) = plans.find((p) => p.id === id)?.display ?? id`.
  - Render below the Providers section, above the Suspend action:

```tsx
<Text style={styles.section}>Plan</Text>
<View style={styles.card}>
  <Text style={styles.cardTitle}>
    {entitlement ? planDisplay(entitlement.plan_id) : "No managed plan — Free"}
  </Text>
  {entitlement ? <Text style={styles.muted}>{entitlement.status}</Text> : null}
</View>
{plans.map((p) => (
  <Pressable
    key={p.id}
    style={[styles.action, busy && styles.actionDisabled]}
    disabled={busy}
    onPress={() => onGrant(p.id)}
  >
    <Text style={styles.actionText}>Grant {p.display}</Text>
  </Pressable>
))}
{entitlement && entitlement.status === "active" ? (
  <Pressable
    style={[styles.action, busy && styles.actionDisabled]}
    disabled={busy}
    onPress={onRevoke}
  >
    <Text style={styles.actionText}>Revoke plan</Text>
  </Pressable>
) : null}
```

- [ ] **Step 7: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Keep existing admin tests green.

- [ ] **Step 8: Commit**

```bash
git add mobile/src/api/adminClient.ts "mobile/app/admin/[sub].tsx" mobile/__tests__
git commit -m "feat(admin): console Grant/Revoke managed plan on the user screen

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Definition of Done — Help

This is a **super-admin operator** surface, not a user-facing feature (the coverage gate governs `FEATURES` in `mobile/src/help-content/features.ts`). No Help topic required — the admin console is not in the user Help catalog. If `npx jest` flags a coverage-test failure tied to this change, revisit; otherwise no Help edit.

## Final verification (after all tasks)

- [ ] `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_admin_api.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] `docker compose -f docker-compose.demo.yml config` parses; both services carry the 7 managed vars.
- [ ] Grant → `managed_unlimited` sets `is_pro`; Revoke sets status `canceled`. `/admin/plans` is super-admin-gated by the shared `require_super_admin` dependency (403 behaviour already covered in `test_super_admin.py`).
- [ ] **Deploy:** backend refresh (ships the compose change; recreate `api` + `celery-worker` to reload env) + web deploy (the console UI). No migration. Then set prod secrets (`MANAGED_ANTHROPIC_API_KEY`, optional `MANAGED_PLAN_EMAILS`, `MANAGED_ACCOUNT_SPEND_CEILING_MICROS`) in `.env.demo` and grant the first cohort.

## Out of scope

- The payment rail (Slice C). A user-facing upgrade CTA. Per-tester managed-cost dashboards beyond the existing `managed_spend_alarm`. Editing plan definitions from the console.
