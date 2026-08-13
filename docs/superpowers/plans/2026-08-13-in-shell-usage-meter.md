# In-shell usage meter (+ metering accuracy) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the in-shell usage meter (compact quota indicator in the app chrome) reading the existing managed-billing data, and record `usage_event`s for the 3 trust async generators so the meter counts ALL managed generation.

**Architecture:** Backend — the trust generators return the `ConformanceResult` (carrying token counts) instead of bare `.parsed`; a shared best-effort `_record_trust_usage` helper wires into the 3 trust Celery tasks (managed-only). Mobile — a `useManagedStatus` hook + `UsageMeterPill` component read `GET /billing/managed-status`, wired into `TopNavBar`/`SideNav`, hidden when there's no managed entitlement.

**Tech Stack:** FastAPI + Celery + asyncpg (backend); React Native (Expo) + `useThemedStyles` (mobile); pytest + fakeredis; Jest + RNTL.

## Global Constraints

- **ADR-001 + best-effort:** usage recording is counts/cost only (no key, no content); the best-effort swallow logs a safe warning (never `str(exc)`); metering must **NEVER** fail a generation. **The meter is non-critical chrome** — a billing-fetch failure hides the meter, never errors the app.
- **No payment rail / no gating** in this slice. Do not touch the RevenueCat webhook, plans, or the existing `/usage` screen.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. No color-literal asserts; theme via `useThemedStyles`/tokens. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Template:** `backend/src/generate/tasks.py::_record_managed_usage` (the main-path metering — mirror its best-effort discipline) + the `if managed: await _record_managed_usage(...)` call site. Read it before writing.

---

### Task 1: Backend — record usage for the 3 trust async generators

**Files:**
- Modify: `backend/src/trust/toc_suggest.py`, `backend/src/trust/generate_topic.py`, `backend/src/trust/generate.py` (return `ConformanceResult`)
- Modify: `backend/src/trust/tasks.py` (add `_record_trust_usage` + wire into `_run` / `_run_suggest` / `_run_version`)
- Test: `backend/tests/test_trust_usage_metering.py` (new); may extend the existing task tests

**Interfaces:**
- Consumes: `pricing.cost_micros`, `usage_repo.record_usage`, `accounts_repo.get_or_create_account`; `generate_validated(...)` returns `ConformanceResult` with `.parsed`, `.total_input_tokens`, `.total_output_tokens`.
- Produces: a `usage_event` row per managed trust generation.

- [ ] **Step 1: Generators return the `ConformanceResult`.** In each generator, change the final line from `return generate_validated(...).parsed` to `return generate_validated(...)` and update the return type annotation to the `ConformanceResult` type (import it from `wegofwd_llm.conformance`). Update the docstring. Example (`toc_suggest.py`):
```python
from wegofwd_llm.conformance import ConformanceResult, generate_validated
def suggest_toc(*, sources, topic, audience, goal, provider_id, api_key, model) -> ConformanceResult:
    ...
    return generate_validated(provider, req, _validate, max_repairs=_MAX_REPAIRS)
```
Do the same for `generate_topic_draft` and `generate_draft`.

- [ ] **Step 2: Update the 3 task call sites to read `.parsed`.** In `tasks.py`, wherever a generator's result is currently consumed as the parsed object, read `.parsed`:
  - `_run_suggest`: `result = await asyncio.to_thread(suggest_toc, ...)`; `toc = toc_output_to_view(result.parsed, sources)`.
  - `_run` (per-topic): the `out` from `generate_topic_draft` → use `out.parsed` where the topic-draft object was used (e.g. the `create_topic_version` content build).
  - `_run_version`: `out.parsed` where `draft_output_to_sections(out, sources)` was called → `draft_output_to_sections(out.parsed, sources)`.
  Run the existing trust task tests to confirm content is unchanged (the `.parsed` object is identical to before).

- [ ] **Step 3: Write the failing metering test** — `backend/tests/test_trust_usage_metering.py`, mirroring `test_trust_version_task.py`'s fixtures. Assert: a **managed** whole-book (or per-topic) job records exactly one `usage_event` for the account with `cost_micros == pricing.cost_micros(provider, model, in, out)` for the generator's token counts; a **BYOK** job records **zero** `usage_event`s; when `usage_repo.record_usage` is patched to raise, the job still completes (`status == "done"`, the version row exists) — metering never fails the job; the api key appears in no usage row/log. Mock the provider so `generate_validated` returns a known `ConformanceResult` (known token counts).

- [ ] **Step 4: Run it — FAIL** (no metering wired yet).

- [ ] **Step 5: Add `_record_trust_usage`** in `tasks.py` (mirror `generate/tasks.py::_record_managed_usage`, but take a live `conn` since the trust tasks own their asyncpg connection):
```python
async def _record_trust_usage(conn, *, account_id, provider, model, input_tokens, output_tokens, job_id) -> None:
    """Best-effort managed metering for a trust generation (ADR-005 D6). Counts/cost only
    — no key, no content. NEVER fails the generation; any error is swallowed with a safe warning."""
    try:
        cost = pricing.cost_micros(provider, model, input_tokens, output_tokens)
        await usage_repo.record_usage(conn, account_id=account_id, provider=provider, model=model,
                                      input_tokens=input_tokens, output_tokens=output_tokens,
                                      cost_micros=cost, job_id=job_id)
        log.info("trust_managed_usage_recorded", job_id=str(job_id), cost_micros=cost)
    except Exception:
        log.warning("trust_managed_usage_record_failed", job_id=str(job_id))
```

- [ ] **Step 6: Wire into the 3 tasks.** After the successful generation + version persist, and BEFORE the `done` status write is fine (or right after), add — only for managed jobs:
```python
if managed:
    try:
        acct = await accounts_repo.get_or_create_account(conn, idp_sub=recorded_by_sub, email=None)
        await _record_trust_usage(conn, account_id=acct.id, provider=provider_id, model=resolved_model,
                                  input_tokens=out.total_input_tokens, output_tokens=out.total_output_tokens,
                                  job_id=job_id)
    except Exception:
        log.warning("trust_managed_usage_record_failed", job_id=str(job_id))
```
(The outer try is belt-and-suspenders so even `get_or_create_account` can't fail the job. `out` = the `ConformanceResult`. Do this in `_run`, `_run_suggest`, `_run_version` with each one's variable names. `accounts_repo` import: match how `billing/router.py` imports it.)

- [ ] **Step 7: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_trust_usage_metering.py tests/test_trust_version_task.py tests/test_trust_suggest_toc_task.py tests/test_trust_topic_task.py -q` (DB-gated). Expected: PASS.

- [ ] **Step 8: Commit**
```bash
git add backend/src/trust/toc_suggest.py backend/src/trust/generate_topic.py backend/src/trust/generate.py backend/src/trust/tasks.py backend/tests/test_trust_usage_metering.py
git commit -m "feat(billing): record managed usage_events for the 3 trust async generators"
```

---

### Task 2: Mobile — `useManagedStatus` hook + `UsageMeterPill` component

**Files:**
- Create: `mobile/src/hooks/useManagedStatus.ts`, `mobile/src/components/UsageMeterPill.tsx`
- Test: `mobile/__tests__/hooks/useManagedStatus.test.tsx`, `mobile/__tests__/components/UsageMeterPill.test.tsx`

**Interfaces:**
- Consumes: `getManagedStatus` + `type ManagedStatus` from `@/api/billingClient`; `useAuth` (token/status); `useThemedStyles`/`Palette`.
- Produces:
  - `useManagedStatus(): { status: ManagedStatus | null; loading: boolean }` — null when signed-out or the fetch fails (never throws).
  - `UsageMeterPill(props: { status: ManagedStatus }): React.JSX.Element | null` — renders null when `status.entitlement === null`.

- [ ] **Step 1: Failing hook test** — signed-in with a token → fetches and returns `status`; signed-out → `{status:null}` and no fetch; a rejected `getManagedStatus` → `{status:null}` (no throw). Mock `@/api/billingClient` + `@/auth/AuthProvider`.

- [ ] **Step 2: Implement `useManagedStatus.ts`:**
```ts
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/auth/AuthProvider";
import { getManagedStatus, type ManagedStatus } from "@/api/billingClient";

export function useManagedStatus(): { status: ManagedStatus | null; loading: boolean } {
  const { accessToken } = useAuth();
  const [status, setStatus] = useState<ManagedStatus | null>(null);
  const [loading, setLoading] = useState(false);
  useFocusEffect(
    useCallback(() => {
      if (!accessToken) { setStatus(null); return; }
      let active = true;
      setLoading(true);
      getManagedStatus(accessToken)
        .then((s) => { if (active) setStatus(s); })
        .catch(() => { if (active) setStatus(null); })  // meter is non-critical chrome
        .finally(() => { if (active) setLoading(false); });
      return () => { active = false; };
    }, [accessToken]),
  );
  return { status, loading };
}
```

- [ ] **Step 3: Run the hook test — PASS.**

- [ ] **Step 4: Failing component test** — for an entitled status renders the plan display + `$used`/`$cap` text + a bar; for `entitlement: null` renders nothing (`toJSON()` null / `queryByRole` null); `allowance_micros: 0` (unlimited) renders no bar but shows "unlimited"; ≥80% shows a warning treatment, ≥100% an over treatment (assert via testID/accessibility state, NOT color literals). `accessibilityRole="button"` present.

- [ ] **Step 5: Implement `UsageMeterPill.tsx`** — pure presentational (takes `status`, no fetching). Format micros→USD (`$${(micros/1_000_000).toFixed(2)}`). `pct = allowance>0 ? clamp(cost/allowance,0,1) : 0`. Level = `allowance===0 ? "unlimited" : pct>=1 ? "over" : pct>=0.8 ? "warn" : "ok"`. Render `null` when `entitlement === null`. Bar width `${pct*100}%` (skip bar when unlimited). Theme tokens for the level colors; `accessibilityRole="button"`, `accessibilityLabel` = the same `plan · $used / $cap` text. (Read an existing themed component, e.g. `GenerateProgressBar.tsx`, for the `(c: Palette) => ({...})` pattern + token names — `c.primary`/`c.border`/`c.textMuted`; pick a semantic token for warn/over or derive from the palette — no literals.)

- [ ] **Step 6: Run the component test — PASS**; then `npx tsc --noEmit`.

- [ ] **Step 7: Commit**
```bash
git add mobile/src/hooks/useManagedStatus.ts mobile/src/components/UsageMeterPill.tsx mobile/__tests__/hooks/useManagedStatus.test.tsx mobile/__tests__/components/UsageMeterPill.test.tsx
git commit -m "feat(billing): useManagedStatus hook + UsageMeterPill component"
```

---

### Task 3: Mobile — wire the meter into the app chrome

**Files:**
- Modify: `mobile/src/components/TopNavBar.tsx`, `mobile/src/components/SideNav.tsx`
- Test: `mobile/__tests__/components/TopNavBar.test.tsx` (+ SideNav test if one exists; else add a focused one)

**Interfaces:**
- Consumes: `useManagedStatus` + `UsageMeterPill` (Task 2); `useRouter` (tap → `/usage`).

- [ ] **Step 1: Failing test** — render `TopNavBar` with `useManagedStatus` mocked to an **entitled** status → the pill shows; mock it to `{status:null}` → no pill (BYOK/anonymous chrome unchanged); tapping the pill calls `router.push("/usage")`. (Mock `@/hooks/useManagedStatus` + `expo-router`.)

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Add a small `ChromeUsageMeter` wrapper** (in `UsageMeterPill.tsx` or a tiny sibling) that calls `useManagedStatus()` and renders `<Pressable onPress={() => router.push("/usage")}><UsageMeterPill status={status} /></Pressable>` when `status` is non-null (the pill itself returns null for a null entitlement, so nothing shows for BYOK). Render it in `TopNavBar`'s row (after the nav items or trailing, so it never breaks the existing horizontal `ScrollView` layout) and in `SideNav` (a suitable slot, e.g. below the nav list). Keep the existing layout intact when the meter is absent.

- [ ] **Step 4: Run the test — PASS**, then full gates: `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.

- [ ] **Step 5: Commit**
```bash
git add mobile/src/components/TopNavBar.tsx mobile/src/components/SideNav.tsx mobile/__tests__/components
git commit -m "feat(billing): in-shell usage meter in the app chrome (TopNavBar + SideNav), tap -> /usage"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_trust_usage_metering.py tests/test_trust_*_task.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] **Security/robustness:** usage recording carries no key (Task 1 test); metering never fails a generation (mock-raise test); the meter hides (never errors the app) on a billing-fetch failure (hook test).
- [ ] **Deploy:** **backend refresh** (worker records trust usage — recreate the celery-worker) **+ web deploy** (the meter). **No migration.**

## Out of scope

- Payment rail (Stripe vs RevenueCat), Free/Pro gating, Publish Pro-wall, changes to the `/usage` screen.
