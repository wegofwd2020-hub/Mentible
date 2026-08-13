# Projects home = Lovable dashboard layout — Design

**Status:** Approved (brainstorming, 2026-08-13). Adapt the Lovable prototype's **dashboard** (`/app`
index — the "projects home") layout onto our **Projects** tab (`mobile/app/(tabs)/projects.tsx`), in
RN/Expo. Our design tokens already match the prototype (Fraunces display + Inter sans + gold accent +
navy primary, from the #413 re-skin), so this is composition + a small backend field exposure — not a
redesign of the design language.

## Current vs target

**Current** (`projects.tsx`): a top "+ New project" button + a FlatList of single-line rows (Card:
title + status + chevron). Functional but flat.

**Target** (Lovable dashboard, `mentible_loverable_ux/src/routes/_authenticated/app/index.tsx`):
1. **Header** — kicker "Your studio" (uppercase, tracked, muted, Inter) + "Projects" (Fraunces display,
   large).
2. **Empty state** — a dashed-border rounded card: accent (gold) icon, "Your first project awaits"
   (Fraunces), an explainer, a "Create project" pill.
3. **Card grid** — responsive project cards: a status kicker + icon row, the title (Fraunces), the topic
   (3-line clamp, muted), and an "audience · goal" footer (uppercase tiny). Hover→accent border on web;
   pressed-state on mobile.

## The data gap (small backend change)

The Lovable card shows **topic / audience / goal**, but our `ProjectSummaryOut` = `{id, title, status,
created_at}` — it drops them, even though `list_projects` already fetches the full `Project` (which has
`topic`/`audience`/`goal`). So: add the 3 fields to `ProjectSummaryOut` + the handler mapping (no query
change, no migration) and to the mobile `ProjectSummaryView`.

## Architecture

### Backend (T1)
- `backend/src/trust/schemas.py::ProjectSummaryOut`: add `topic: str | None`, `audience: str | None`,
  `goal: str | None`.
- `backend/src/trust/router.py::list_owned_projects` (the `GET /projects` handler): include those 3 from
  the already-fetched `Project` rows in each `ProjectSummaryOut(...)`.
- Additive/backward-compatible (older clients ignore the new fields).

### Mobile (T2) — `projects.tsx` redesign
- `mobile/src/api/trustClient.ts`: `ProjectSummaryView` += `topic: string | null; audience: string | null;
  goal: string | null`.
- **Header:** a kicker `Text` ("YOUR STUDIO", uppercase, `letterSpacing`, `textMuted`, Inter) + a Fraunces
  title "Projects" (~28–34px). New-project as a **primary pill** — top-right of the header on wide
  (`useResponsive().isTablet`), full-width below the header on phone. **Preserve the Slice-B cap wall:**
  read `useBillingPlan()`; when `plan && !plan.is_pro && plan.at_project_cap` disable the pill with a "Free
  limit reached — upgrade to Pro" hint (fail-open when `plan == null`); on `router.push("/trust/new")` the
  existing new-project flow keeps its own 402 handling.
- **Empty state:** a dashed-border rounded card (`borderStyle:"dashed"`, `borderRadius: radius.lg`,
  centered, padding `xl`) — an accent (gold) icon (emoji `✦`/`✨` or `@expo/vector-icons` Feather, match the
  app's convention; library.tsx uses an emoji `Text`), "Your first project awaits" (Fraunces), the
  explainer copy, and a "Create project" pill (same cap-aware action).
- **Card grid:** replace the single-line rows. Each card (`<Card>`): a top row = a small icon
  (Feather `file-text` or a glyph) + the status (`status.replace("_"," ")`, uppercase, tracked,
  `textMuted`); the **title** (Fraunces ~22px, `numberOfLines={2}`); the **topic** (`numberOfLines={3}`,
  `textSecondary`) when present; a footer row = `audience` `·` `goal` (uppercase tiny, `textMuted`,
  truncated) when present. Pressed state → accent border / opacity (RN has no hover). Tap →
  `router.push("/trust/${id}")`.
- **Responsive grid:** `useResponsive().isTablet` (or `isDesktop`) → **2 columns** (FlatList `numColumns={2}`
  with a `columnWrapperStyle` gap, or a flex-wrap row); 1 column on phone. Keep the `RequireSignIn` +
  `PageContainer flex:1` wrapper and the `useFocusEffect(refresh)`.

## Testing

- **Backend:** `GET /projects` returns `topic`/`audience`/`goal` in each summary (a project with those set
  surfaces them; nulls pass through). Existing list test updated for the new fields.
- **Mobile:** renders the header (kicker + "Projects"); the empty state (dashed card + "Your first project
  awaits" + Create) when no projects; a card grid with title + status + topic + audience·goal when
  projects exist; tapping a card navigates to `/trust/{id}`; the New-project pill is disabled with the hint
  when `at_project_cap` (Free) and enabled otherwise / when plan is null (fail-open). No color-literal
  asserts; theme via tokens.

## Decomposition (SDD)

- **T1 — backend:** expose `topic`/`audience`/`goal` on `ProjectSummaryOut` + the `list_owned_projects`
  mapping. Test.
- **T2 — mobile:** `ProjectSummaryView` fields + the `projects.tsx` redesign (header, empty state, card
  grid, responsive, cap-aware New-project). Tests.

## Rollout

**Backend refresh + web deploy.** No migration. Backend-first or together (the mobile card degrades
gracefully if a field is absent — it's optional).

## Out of scope

- The rest of the Lovable dashboard/app screens (new-project form, the 4-tab workspace, etc.) — this slice
  is the **projects home** only. A payment-rail upgrade CTA (Slice C). Changing the New-project flow itself
  (only its entry pill's cap-awareness, which already exists).

## Global constraints

- Preserve the Slice-B project-cap wall (fail-open) + `RequireSignIn`. No color-literal asserts; theme via
  `useThemedStyles`/tokens; Fraunces from `@/constants/fonts`. `Alert` from `@/lib/alert`. Backend
  `ruff check` **and** `ruff format --check`; mobile `npx tsc --noEmit` + full `npx jest` + `npx eslint .`.
  Commit messages end with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
