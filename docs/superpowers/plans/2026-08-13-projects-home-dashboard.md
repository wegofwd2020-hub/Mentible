# Projects home = Lovable dashboard layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the Projects tab (`mobile/app/(tabs)/projects.tsx`) as the Lovable dashboard: a kicker + Fraunces "Projects" header, a dashed-card empty state, and a responsive project-card grid (status · title · topic · audience·goal), preserving RequireSignIn + the Slice-B project-cap wall.

**Architecture:** Backend exposes `topic`/`audience`/`goal` on the project summary (data already fetched). Mobile adds those fields to the summary type and rebuilds the screen with our existing tokens (Fraunces + gold + navy already match the prototype).

**Tech Stack:** FastAPI + asyncpg (backend); React Native (Expo), `useThemedStyles`, `useResponsive`, `@expo/vector-icons`/emoji (mobile); pytest; Jest + RNTL.

## Global Constraints

- Preserve `RequireSignIn` + the **Slice-B project-cap wall** (New-project disabled + "Free limit reached — upgrade" hint at `plan.at_project_cap`; **fail-open** when `plan == null`) via `useBillingPlan`.
- No color-literal asserts; theme via `useThemedStyles`/tokens; Fraunces from `@/constants/fonts`. `Alert` from `@/lib/alert`.
- Backend `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`. Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **Confirmed facts:** `list_owned_projects` (`backend/src/trust/router.py:428`) builds `ProjectSummaryOut` from `Project` objects that already carry `p.topic`/`p.audience`/`p.goal`. `useResponsive(): { width, isTablet, isDesktop }`. Current screen: `mobile/app/(tabs)/projects.tsx` (71 lines) — top "+ New project" `Button` + a `FlatList` of single-line `Card` rows, wrapped in `RequireSignIn` + `PageContainer flex:1`, `useFocusEffect(refresh)`, `useOwnedProjects()`.

---

### Task 1: Backend — expose topic/audience/goal on the project summary

**Files:**
- Modify: `backend/src/trust/schemas.py` (`ProjectSummaryOut`)
- Modify: `backend/src/trust/router.py` (`list_owned_projects` mapping)
- Test: `backend/tests/test_trust_router.py` (extend the projects-list coverage)

**Interfaces:**
- Produces: `GET /projects` items now include `topic: str | None`, `audience: str | None`, `goal: str | None`.

- [ ] **Step 1: Extend `ProjectSummaryOut`** in `schemas.py`:
```python
class ProjectSummaryOut(BaseModel):
    id: str
    title: str
    status: str
    created_at: datetime | None
    topic: str | None = None
    audience: str | None = None
    goal: str | None = None
```

- [ ] **Step 2: Write the failing test** — in `test_trust_router.py`, create a project with `topic`/`audience`/`goal` set, then `GET /api/v1/trust/projects` and assert the summary item carries those three fields (and a project created without them returns nulls). Use the existing `TestClient`/auth fixtures in that file.

- [ ] **Step 3: Run it — FAIL** (summary omits the fields).

- [ ] **Step 4: Map the fields** in `list_owned_projects` (`router.py:428`):
```python
    return [
        schemas.ProjectSummaryOut(
            id=str(p.id),
            title=p.title,
            status=p.status,
            created_at=p.created_at,
            topic=p.topic,
            audience=p.audience,
            goal=p.goal,
        )
        for p in projects
    ]
```

- [ ] **Step 5: Run** — `cd backend && ruff check . && ruff format --check . && python -m pytest tests/test_trust_router.py -q`. Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add backend/src/trust/schemas.py backend/src/trust/router.py backend/tests/test_trust_router.py
git commit -m "feat(trust): expose topic/audience/goal on the project summary (for the dashboard cards)"
```

---

### Task 2: Mobile — Projects tab as the dashboard layout

**Files:**
- Modify: `mobile/src/api/trustClient.ts` (`ProjectSummaryView` fields)
- Rewrite: `mobile/app/(tabs)/projects.tsx`
- Test: `mobile/__tests__/screens/` — the Projects screen test (find/extend; e.g. `Projects.test.tsx`, else add one)

**Interfaces:**
- Consumes: `useOwnedProjects()` (`{ projects, loading, error, refresh }`), `useBillingPlan()`, `useResponsive()`, `useThemedStyles`, `FRAUNCES`.

- [ ] **Step 1: Add the fields** to `ProjectSummaryView` in `trustClient.ts`:
```ts
export interface ProjectSummaryView { id: string; title: string; status: string; created_at: string | null; topic: string | null; audience: string | null; goal: string | null }
```
(Match the existing `ProjectSummaryView` declaration's style; it currently lacks the last 3.)

- [ ] **Step 2: Write the failing screen test** — `mobile/__tests__/screens/Projects.test.tsx` (or extend an existing one). Mock `useOwnedProjects` + `useBillingPlan` + `expo-router`. Assert:
  - Header: a "Projects" title renders (and the "Your studio" kicker).
  - Empty state (projects `[]`): "Your first project awaits" + a "Create project" control that navigates to `/trust/new`.
  - Populated: a card per project showing `title`, the `status` (formatted), the `topic`, and `audience`/`goal`; tapping a card → `router.push("/trust/{id}")`.
  - New-project pill: disabled with a "Free limit reached" hint when `useBillingPlan` → `{ plan: { is_pro:false, at_project_cap:true, ... } }`; enabled when Pro, and enabled (fail-open) when `plan: null`.
  No color-literal asserts.

- [ ] **Step 3: Run it — FAIL.**

- [ ] **Step 4: Rewrite `projects.tsx`.** Keep the `ProjectsScreen` wrapper (`RequireSignIn action="manage projects"` + `PageContainer flex:1`). In `ProjectsInner`:
  - `const { isTablet } = useResponsive(); const { plan } = useBillingPlan();` + the existing `useOwnedProjects()` + `useFocusEffect(refresh)`.
  - `const atProjectCap = plan != null && !plan.is_pro && plan.at_project_cap;`
  - A **NewProjectButton** (primary pill, "+ New project" / "Create project"): `onPress → router.push("/trust/new")`; `disabled={atProjectCap}`; when `atProjectCap` show a small hint `Text` "Free limit reached — upgrade to Pro" (link to `/usage`). Placement: in the header row on `isTablet` (top-right), full-width below the header on phone.
  - **Header:** a kicker `Text` "YOUR STUDIO" (uppercase, `letterSpacing`, `textMuted`, sans) + a Fraunces title "Projects" (`FRAUNCES.semibold`, ~28–34px). 
  - **Empty state** (`projects.length === 0`, not loading/error): a `View` with `borderStyle:"dashed"`, `borderColor: c.border`, `borderRadius`(lg), centered, padding `xl` — an accent icon (emoji `✦` in a `Text` sized ~40, color `c.primary`/gold, matching `library.tsx`'s emptyIcon pattern, OR `@expo/vector-icons`), "Your first project awaits" (Fraunces), the explainer copy, and the NewProjectButton.
  - **Card grid:** a `FlatList` (`numColumns={isTablet ? 2 : 1}`, with a `columnWrapperStyle={{ gap }}` when 2-col; `key`/`numColumns` remount is fine on rotation). Each item = a `Pressable` (`accessibilityRole="button"`, `accessibilityLabel={`Open project: ${title}`}`, `onPress → router.push(`/trust/${id}`)`) wrapping a `<Card>`:
    - Top row: a small icon/glyph + `status.replace("_", " ")` (uppercase, tracked, `textMuted`).
    - Title: `numberOfLines={2}`, `FRAUNCES.semibold`, ~22px.
    - `topic` (if present): `numberOfLines={3}`, `textSecondary`.
    - Footer (if `audience` or `goal`): `audience` `·` `goal` (uppercase tiny, `textMuted`, `numberOfLines={1}`).
    - Pressed state: accent border or reduced opacity (RN has no hover).
  - Keep `loading`→ActivityIndicator and `error`→text as today.

- [ ] **Step 5: Run** — `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`. Fix any existing Projects test that asserted the old single-line row shape.

- [ ] **Step 6: Commit**
```bash
git add mobile/src/api/trustClient.ts mobile/app/(tabs)/projects.tsx mobile/__tests__
git commit -m "feat(trust): Projects tab as the dashboard layout (header + empty-state card + responsive card grid)"
```

---

## Final verification (after all tasks)

- [ ] `ruff check backend && ruff format --check backend && python -m pytest tests/test_trust_router.py -q`; `cd mobile && npx jest && npx tsc --noEmit && npx eslint .`.
- [ ] The cap wall is preserved (New-project disabled at cap, fail-open on null plan); `RequireSignIn` intact; tapping a card navigates.
- [ ] **Deploy:** backend refresh + web deploy (the summary now returns 3 more fields; the mobile grid reads them). No migration.

## Out of scope

- The rest of the Lovable app screens (new-project form, the 4-tab workspace). A payment-rail upgrade CTA (Slice C). Changing the New-project flow itself.
