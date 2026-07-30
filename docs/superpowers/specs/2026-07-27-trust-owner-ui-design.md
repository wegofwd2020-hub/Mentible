# Trust — Owner Authoring UI — Design Spec

**Status:** Approved (2026-07-27) · **ADR-037 follow-on** to the reviewer UI ([#345]) + owned-list/recorded_via backend ([#346]).
**Builds on:** #345 (reviewer UI — `trustClient`, `useTrustProject`, `app/trust/[projectId].tsx`) + #346 (`GET /projects`, `recorded_via`). This branch is cut from `feat/trust-reviews-ui`; its diff includes #345 until it merges.
**Scope:** the **operator/owner** side of the trust loop in the mobile/web app — list your owned projects, create a new one, and on a project add artifacts + versions and invite an expert. Extends the existing `trustClient`/detail screen (role-aware). Also surfaces the `recorded_via` provenance badge (now that #346 returns it). Mobile-only.

## Why
#345 gave the reviewer experience; #346 unblocked the owner side (owned-list + provenance). This closes the operator half so the whole loop is usable in-app: an operator sets up a project + invites an expert, who then reviews & approves (#345).

## Grounding (extend, don't duplicate — verified on this branch)
- **`mobile/src/api/trustClient.ts`** — has `syncSession`/`getProject`/`approveVersion` + views. Add the owner calls + a `ProjectSummaryView` + `recorded_via` on `VersionSummaryView`.
- **`mobile/app/(tabs)/reviews.tsx`** — the list-screen pattern (RequireSignIn, `useFocusEffect(refresh)`, loading/empty/error, `FlatList` rows → `router.push`). Mirror for the owned "Projects" list.
- **`mobile/app/trust/[projectId].tsx`** — the detail screen (renders `artifacts.map → versions.map`, Approve on awaiting versions). Extend it **role-aware**: `my_role === "owner"` adds Invite / Add-artifact / Add-version actions; add the `recorded_via` badge on validated versions (both roles).
- **`mobile/src/hooks/useTrustProject.ts`** — `{project, ..., approve}`. Add owner mutations (`addArtifact`, `addVersion`, `invite`) that call the client then `refresh`.
- Forms: `ShareDraftModal.tsx` idiom (bottom-sheet `Modal`, controlled `TextInput`, submit + `try/catch` + `setError`); `@/lib/alert` for confirms.
- Nav: a tab needs 3 edits (`(tabs)/_layout.tsx`, `TopNavBar` TABS/ORDER, `labels.ts` NAV) + `IS_DEMO` exclusion + a Help topic (DoD gate).

## Global Constraints
- Mobile-only; extend `trustClient.ts`, `useTrustProject.ts`; add `useOwnedProjects.ts`, `app/(tabs)/projects.tsx`, a New-Project form, extend `app/trust/[projectId].tsx`; nav+Help edits.
- Theme tokens only (no hardcoded colors); `Alert` from `@/lib/alert`; `RequireSignIn` + `IS_DEMO`-excluded tab.
- Tests: Jest+RNTL, mock `trustClient`/hooks + `expo-router` + `@/lib/alert`; run `cd mobile && npm test -- <path>`.
- Owner-only actions render only when `my_role === "owner"` (client-side affordance; the backend 403s reviewers regardless).

---

## `trustClient.ts` additions
```ts
export interface ProjectSummaryView { id: string; title: string; status: string; created_at: string | null }
export interface InvitationView { project_id: string; invited_email: string; role: string; revoked_at: string | null }
export interface VersionCreatedView { id: string; artifact_id: string; version_no: number; created_at: string | null }
// extend VersionSummaryView with: recorded_via: string | null   (#346)

listOwnedProjects(token): Promise<ProjectSummaryView[]>                         // GET /projects
createProject(body:{title;topic?;audience?;goal?}, token): Promise<ProjectView> // POST /projects
createArtifact(projectId, body:{role;format;title?}, token): Promise<ArtifactView> // POST /projects/{id}/artifacts
createVersion(artifactId, body:{content:object;generation_meta?:object}, token): Promise<VersionCreatedView> // POST /artifacts/{id}/versions
invite(projectId, email, token): Promise<InvitationView>                        // POST /projects/{id}/invitations
```

## Hooks
- **`useOwnedProjects()`** (new, mirror `useReviews`) — `{ projects: ProjectSummaryView[], loading, error, refresh, create(body) }`; `listOwnedProjects` on `signed_in`; `create` → `createProject` then `refresh`, returns the new `ProjectView`.
- **`useTrustProject(projectId)`** (extend) — add `addArtifact(role, format, title?)`, `addVersion(artifactId, content)`, `invite(email)`; each calls the client then `await refresh()`.

## Screens

### `app/(tabs)/projects.tsx` — owned "Projects" tab
Mirror `reviews.tsx`: `RequireSignIn action="manage projects"`, `useOwnedProjects`, `useFocusEffect(refresh)`, loading/empty/error, `FlatList` rows (title · status) → `router.push('/trust/{id}')`. A **New Project** button (header or FAB) → opens the New-Project form.

### New-Project form (`app/trust/new.tsx` Stack screen, or a modal in projects.tsx)
Fields: title (required), topic, audience, goal → `create({...})` → on success `router.replace('/trust/{newId}')`. `ShareDraftModal`-style inputs; `@/lib/alert` on error.

### `app/trust/[projectId].tsx` — extend role-aware
- Both roles: versions render with the badge — **Validated ✓** + (when validated) a small provenance chip from `recorded_via` ("expert-validated" for `expert_self`, "operator-recorded" for `operator`); **Awaiting** otherwise. (Reviewer keeps the Approve button on awaiting versions, from #345.)
- **When `my_role === "owner"`:** show owner actions —
  - **Invite** (email → `invite(email)`; `ShareDraftModal`-style modal or inline row).
  - **Add artifact** (role + format + optional title → `addArtifact`).
  - **Add version** to an artifact (a simple content field → `addVersion(artifactId, { text })` — MVP content is `{ text }` jsonb; real LLM authoring is separate).
  - Owner may also Approve (backend records `operator`) — keep the existing Approve button visible for owner too (it already appears on awaiting versions regardless of role; the backend distinguishes provenance).

## Nav + Help
- `(tabs)/_layout.tsx`: `<Tabs.Screen name="projects" />`.
- `TopNavBar`: `projects` in `TABS` (an icon glyph, e.g. `folder`/`documents`) + `ORDER` (excluded when `IS_DEMO`).
- `labels.ts`: `projects: "Projects"`.
- `app/_layout.tsx`: `<Stack.Screen name="trust/new" options={{ title: "New project", headerBackTitle: "Projects" }} />` (if a route rather than a modal).
- Help: `{ key: "projects", label: "Creating & managing projects" }` in `FEATURES` + a matching `featureKey: "projects"` topic (create → add content → invite an expert).

## Testing (Jest+RNTL, mock `trustClient`/hooks)
- `trustClient`: the 5 new fns POST/GET the right URLs + bodies + bearer (mock fetch).
- `useOwnedProjects`: lists from mock; `create` calls client + refreshes.
- `useTrustProject` owner mutations: `addArtifact`/`addVersion`/`invite` call the client then refresh.
- `projects.tsx`: renders owned list, empty state, navigates; New-Project submit calls `create`.
- `[projectId].tsx` (extended): owner sees Invite/Add actions (mock `my_role:"owner"`); reviewer does NOT (mock `my_role:"reviewer"`); validated version shows the `recorded_via` chip.
- Help coverage test passes with the new `projects` feature+topic.

## Out of scope
- LLM-generated version content (Add-version uses a plain text field; generation is a separate engine concern).
- Editing/deleting projects/artifacts/versions; revoke/list invitations UI (invite-only for MVP).
- Merging the "Projects" and "Reviews" tabs into one unified area (kept separate per the two roles).
- Backend changes (all endpoints exist: #344 + #346).

## Open items (resolve in the plan, non-blocking)
1. New Project as a Stack route (`app/trust/new.tsx`) vs a modal inside `projects.tsx` — the plan picks one (route is simpler to test in isolation).
2. Projects-tab icon glyph.
3. Whether owner Add-version is per-artifact inline or a modal — plan decides (inline row per artifact is simplest).
