# Trust Reviews UI (Reviewer Read + Approve) — Design Spec

**Status:** Approved (2026-07-27) · **ADR-037 follow-on** to the trust router ([#344]) + (b)[#342] + (c)[#343].
**Scope:** the **mobile/web reviewer experience** — an invited expert signs in, sees the projects they can review, opens one, and records an approval (`expert_self`). Consumes the `/api/v1/trust/*` HTTP contract; **mobile-only code** (no backend changes). The operator-authoring UI is a later slice (it needs a backend `GET /projects` owned-list that doesn't exist yet).

## Why the reviewer slice first
It is the product moat (the "authenticated expert approved" experience) **and** the only side the current router fully supports: `session/sync` returns the caller's reviewer memberships; `GET /projects/{id}` + `POST /versions/{id}/approvals` do the rest. The owner side can't re-list its projects yet, so it waits.

## Grounding — mobile idioms (mirror exactly)
- **API client:** copy `mobile/src/api/accountClient.ts` — `authFetch(path, token, init)` with `Authorization: Bearer <token>`, `ApiError` from `src/api/client.ts`, base URL via `resolveBaseUrl()`.
- **Token:** `useAuth()` (`src/auth/AuthProvider.tsx`) → `accessToken` (Supabase session JWT) + `status`.
- **Hook:** copy `src/hooks/useAccount.ts` — `{data, loading, error, refresh}`, `refresh` gated on `accessToken`, auto-load `useEffect` on `status === "signed_in"`.
- **Screen:** mirror `app/(tabs)/books.tsx` — `RequireSignIn` gate, focus-load, `ActivityIndicator`/empty states, theme tokens, `PageContainer`, `useResponsive`.
- **Forms/confirm:** `@/lib/alert` `Alert` (NOT `react-native`) for confirms; input idiom from `ShareDraftModal.tsx`.
- **Nav:** a tab needs 3 edits — `app/(tabs)/_layout.tsx` (`<Tabs.Screen>`), `src/components/TopNavBar.tsx` (`TABS` map + `ORDER`), `src/constants/labels.ts` (`NAV`); detail routes are `Stack.Screen`s in `app/_layout.tsx`.
- **Demo gate:** `IS_DEMO` (`src/constants/demo.ts`) — hide the tab in demo (no backend); `RequireSignIn` handles `signed_out`.
- **Help DoD:** a user-facing feature MUST add a `FEATURES` key (`src/help-content/features.ts`) + a matching Help topic (`src/help-content/topics.ts`) in the same PR — enforced by `mobile/__tests__/help/coverage.test.ts`.

## Global Constraints
- Mobile-only: `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useReviews.ts`, `mobile/src/hooks/useTrustProject.ts`, `mobile/app/(tabs)/reviews.tsx`, `mobile/app/trust/[projectId].tsx`, nav-wiring edits, Help entries. No backend changes.
- Runs on native AND web (react-native-web) — no web-hostile APIs; confirms via `@/lib/alert`.
- The Reviews tab is a **real authed feature**: wrap in `RequireSignIn`; **do not register it in nav when `IS_DEMO`**.
- Theme only via `@/constants/theme` tokens (`colors`/`spacing`/`radius`/`typography`) — no hardcoded colors (fits the multi-theme direction, #340).
- Tests: Jest + RNTL, **mock `trustClient`** (no live backend in mobile CI — CLAUDE.md). Component tests for the list, detail, and approve flow. A manual web-render smoke before merge.
- `accessToken` may be null (loading/signed-out) — every call guards on it.

---

## The API client (`mobile/src/api/trustClient.ts`)

Mirror `accountClient.authFetch` against `/api/v1/trust`. Only the reviewer-slice calls:

```ts
export interface MembershipView { project_id: string; role: string }
export interface SessionSyncView { account_id: string; email: string | null; memberships: MembershipView[] }
export interface VersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean }
export interface ArtifactDetailView { artifact: {...}; versions: VersionSummaryView[] }
export interface ProjectDetailView { project: {...}; artifacts: ArtifactDetailView[]; my_role: string }
export interface ApprovalView { id: string; version_id: string; expert_name: string; approved_at: string; recorded_via: string }

syncSession(token): Promise<SessionSyncView>                 // POST /session/sync
getProject(projectId, token): Promise<ProjectDetailView>     // GET /projects/{id}
approveVersion(versionId, body, token): Promise<ApprovalView> // POST /versions/{id}/approvals  body:{approved_at, note?}
```
(Types mirror the backend `schemas.py` response models. `ApiError` surfaces backend 403/404/422 with `.userMessage()`.)

## Hooks

### `useReviews()` (`mobile/src/hooks/useReviews.ts`)
Copy `useAccount`. On `signed_in`: `syncSession(token)` (redeems + returns memberships) → the memberships are exactly the **reviewer** projects (owners hold no membership row) → `getProject(m.project_id)` for each → build a list of `{project_id, title, versionsTotal, versionsValidated}`. Returns `{reviews, loading, error, refresh}`. Reload on focus.

### `useTrustProject(projectId)` (`mobile/src/hooks/useTrustProject.ts`)
`getProject(projectId, token)` → `{project, loading, error, refresh}`; plus `approve(versionId, note?)` → `approveVersion(...)` then `await refresh()`; exposes the returned `ApprovalView` (so the caller can show "expert-validated by you" from `recorded_via`).

## Screens

### `app/(tabs)/reviews.tsx` — "Reviews" tab
- Default export wraps `<RequireSignIn action="review projects">`.
- `useReviews()`; loading → `ActivityIndicator`; empty → "No projects to review yet. When an expert invites you, they'll appear here."
- List rows (via `PageContainer` + `FlatList`): project **title** · a meta line "**{validated}/{total} versions validated**" · chevron. Tap → `router.push('/trust/' + project_id)`.
- Reuse the row/detail idiom from `books.tsx`.

### `app/trust/[projectId].tsx` — project detail + approve
- `Stack.Screen` (register in `app/_layout.tsx` with `title` + `headerBackTitle: "Reviews"`).
- `useTrustProject(id)`; project title/topic header; then per artifact → its versions.
- Each **version row**: "v{version_no}" + a badge — **`Validated ✓`** (green `colors.growth`) when `is_validated`, else **`Awaiting review`** (muted) + an **Approve** button.
- **Approve** → `Alert` confirm ("Record your approval of v{n}? This is logged as expert-validated by you.") → on confirm `approve(versionId)` → on success refresh + a success `Alert` ("Approved — recorded as {approval.recorded_via==='expert_self' ? 'expert-validated' : 'recorded'}."). On `ApiError` → `Alert` with `.userMessage()`.
- `my_role` from the detail governs whether Approve shows (reviewer or owner both may; this slice targets reviewer).

## Nav + Help wiring
- `app/(tabs)/_layout.tsx`: add `<Tabs.Screen name="reviews" />`.
- `src/components/TopNavBar.tsx`: add `reviews` to the `TABS` map (icon) + `ORDER`.
- `src/constants/labels.ts`: add `reviews: "Reviews"` to `NAV`.
- **Demo:** in `TopNavBar` ORDER (or the tab registration), exclude `reviews` when `IS_DEMO`.
- `app/_layout.tsx`: add `<Stack.Screen name="trust/[projectId]" options={{ title: "Project", headerBackTitle: "Reviews" }} />`.
- Help: add `{ key: "reviews", label: "Reviewing & approving projects" }` to `FEATURES`; add a topic with `featureKey: "reviews"` to `HELP_TOPICS`.

## Testing
Jest + RNTL, mock `mobile/src/api/trustClient` (and `useAuth` to supply a token):
- `reviews.tsx`: renders the review list from a mocked `useReviews`/client; empty state; a row press navigates.
- `[projectId].tsx`: renders versions with the right badge per `is_validated`; the Approve button appears only for a non-validated version; pressing it (confirm auto-accepted via the `@/lib/alert` mock) calls `approveVersion` and refreshes; an `ApiError` surfaces the message.
- Help coverage test passes (the new `reviews` feature has its topic).
- Manual: a web-render smoke (`RequireSignIn` shows the sign-in card when signed-out; the tab hidden in `IS_DEMO`).

## Out of scope (later slices)
- Operator authoring UI (create project/artifact/version, invite) — needs the backend `GET /projects` owned-list first.
- Rendering `recorded_via` on *pre-existing* approvals in the list (the `GET` version summary returns only `is_validated`; needs a backend field — the pinned "badges must render recorded_via" carry-forward). This slice shows `recorded_via` only for an approval the user just created (from the POST response).
- Eager `session/sync` on sign-in via a global mount (this slice syncs on the Reviews tab load; redeem is idempotent).
- Feedback/comments UI; version content rendering (this slice validates, it doesn't render the full draft).
- Real device build; end-to-end against a live backend (component tests mock the client).

## Open items (resolve in the plan, non-blocking)
1. Reviews tab icon in `TopNavBar` (pick an existing icon-set glyph, e.g. a check-seal / clipboard).
2. Whether version content is viewable in this slice — spec says no (validate-only); a "view draft" action is a later slice.
3. `approved_at` value sent on approve — the client sets it to the current time (`new Date().toISOString()`); no user date-picker.
