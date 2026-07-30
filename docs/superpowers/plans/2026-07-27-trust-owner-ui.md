# Trust Owner Authoring UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The operator/owner side of the trust loop in the app — an owned "Projects" tab + New-Project form, and role-aware owner actions on the detail screen (invite an expert, add an artifact, add a version), plus the `recorded_via` provenance badge.

**Architecture:** Extend #345's mobile trust feature: add owner calls to `trustClient`, a `useOwnedProjects` hook + owner mutations on `useTrustProject`, a `Projects` tab + New-Project route, and role-aware additions to the existing `app/trust/[projectId].tsx`. Mobile-only; no backend changes (endpoints exist: #344 + #346). Jest+RNTL with mocked `trustClient`/hooks.

**Tech Stack:** React Native + Expo (expo-router), TypeScript, Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-07-27-trust-owner-ui-design.md`.

## Global Constraints

- All code under `mobile/`. New: `mobile/src/hooks/useOwnedProjects.ts`, `mobile/app/(tabs)/projects.tsx`, `mobile/app/trust/new.tsx`. Extend: `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useTrustProject.ts`, `mobile/app/trust/[projectId].tsx`. Edit: `mobile/app/(tabs)/_layout.tsx`, `mobile/src/components/TopNavBar.tsx`, `mobile/src/constants/labels.ts`, `mobile/app/_layout.tsx`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`.
- Theme tokens only (no hardcoded colors). `Alert` from `@/lib/alert` (NEVER `react-native`). `RequireSignIn`-gated screens; the `projects` tab excluded from nav when `IS_DEMO`.
- Owner-only affordances render only when `my_role === "owner"`.
- Tests from `mobile/`: `cd mobile && npm test -- <path>`. Mock `@/api/trustClient` / the hooks / `expo-router` / `@/lib/alert` (auto-press confirm) per `mobile/__tests__/components/SharedWithYou.test.tsx` + the #345 `TrustProjectDetail.test.tsx`. Route imports: `@/../app/(tabs)/<name>`.
- Help DoD: adding the `projects` `FEATURES` key REQUIRES a matching topic in the same task, or `__tests__/help/coverage.test.ts` fails.
- No backend files touched.

---

### Task 1: `trustClient` owner calls + `recorded_via` field

**Files:**
- Modify: `mobile/src/api/trustClient.ts`
- Test: `mobile/__tests__/api/trustClient.owner.test.ts`

**Interfaces:**
- Produces: `ProjectSummaryView`, `InvitationView`, `VersionCreatedView`; `VersionSummaryView.recorded_via`; `listOwnedProjects`, `createProject`, `createArtifact`, `createVersion`, `invite`.

- [ ] **Step 1: Write the failing test** (mock `fetch`, mirror the existing `trustClient.test.ts`)

```ts
// mobile/__tests__/api/trustClient.owner.test.ts
import { listOwnedProjects, createProject, createArtifact, createVersion, invite } from "@/api/trustClient";

const okJson = (b: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(b) } as Response);
beforeEach(() => jest.restoreAllMocks());

it("createProject POSTs body + bearer", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() => okJson({ id: "p1", title: "T", status: "active", created_at: null }));
  const out = await createProject({ title: "T" }, "tok");
  expect(out.id).toBe("p1");
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/projects");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).body).toBe(JSON.stringify({ title: "T" }));
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
});

it("listOwnedProjects GETs the list", async () => {
  jest.spyOn(global, "fetch").mockImplementation(() => okJson([{ id: "p1", title: "T", status: "active", created_at: null }]));
  expect(await listOwnedProjects("tok")).toHaveLength(1);
});

it("createArtifact / createVersion / invite hit the right URLs", async () => {
  const spy = jest.spyOn(global, "fetch")
    .mockImplementation(() => okJson({ id: "x", artifact_id: "a", version_no: 1, created_at: null, project_id: "p1", role: "cornerstone", format: "book", title: null, invited_email: "e@x.z", revoked_at: null }));
  await createArtifact("p1", { role: "cornerstone", format: "book" }, "tok");
  await createVersion("a", { content: { text: "hi" } }, "tok");
  await invite("p1", "E@X.Z", "tok");
  const urls = spy.mock.calls.map((c) => String(c[0]));
  expect(urls[0]).toContain("/api/v1/trust/projects/p1/artifacts");
  expect(urls[1]).toContain("/api/v1/trust/artifacts/a/versions");
  expect(urls[2]).toContain("/api/v1/trust/projects/p1/invitations");
});
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npm test -- __tests__/api/trustClient.owner.test.ts` → FAIL (exports missing).

- [ ] **Step 3: Extend `trustClient.ts`** — add the interfaces + `recorded_via` + the 5 functions (using the existing `trustFetch`):

```ts
export interface ProjectSummaryView { id: string; title: string; status: string; created_at: string | null }
export interface InvitationView { project_id: string; invited_email: string; role: string; revoked_at: string | null }
export interface VersionCreatedView { id: string; artifact_id: string; version_no: number; created_at: string | null }
```
Extend `VersionSummaryView` to include `recorded_via: string | null`. Then:
```ts
export async function listOwnedProjects(token: string): Promise<ProjectSummaryView[]> {
  return (await trustFetch<ProjectSummaryView[]>("/projects", token, { method: "GET" })) as ProjectSummaryView[];
}
export async function createProject(
  body: { title: string; topic?: string; audience?: string; goal?: string }, token: string,
): Promise<ProjectView> {
  return (await trustFetch<ProjectView>("/projects", token, { method: "POST", body: JSON.stringify(body) })) as ProjectView;
}
export async function createArtifact(
  projectId: string, body: { role: string; format: string; title?: string }, token: string,
): Promise<ArtifactView> {
  return (await trustFetch<ArtifactView>(`/projects/${projectId}/artifacts`, token, { method: "POST", body: JSON.stringify(body) })) as ArtifactView;
}
export async function createVersion(
  artifactId: string, body: { content: object; generation_meta?: object }, token: string,
): Promise<VersionCreatedView> {
  return (await trustFetch<VersionCreatedView>(`/artifacts/${artifactId}/versions`, token, { method: "POST", body: JSON.stringify(body) })) as VersionCreatedView;
}
export async function invite(projectId: string, email: string, token: string): Promise<InvitationView> {
  return (await trustFetch<InvitationView>(`/projects/${projectId}/invitations`, token, { method: "POST", body: JSON.stringify({ email }) })) as InvitationView;
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "trustClient" || echo "no new type errors"
git add mobile/src/api/trustClient.ts mobile/__tests__/api/trustClient.owner.test.ts
git commit -m "feat(trust-ui): trustClient owner calls + recorded_via (ADR-037)"
```

---

### Task 2: `useOwnedProjects` + owner mutations on `useTrustProject`

**Files:**
- Create: `mobile/src/hooks/useOwnedProjects.ts`
- Modify: `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/hooks/useOwnedProjects.test.tsx`, `mobile/__tests__/hooks/useTrustProject.owner.test.tsx`

**Interfaces:**
- Produces: `useOwnedProjects() -> { projects: ProjectSummaryView[]; loading; error; refresh; create(body) -> Promise<ProjectView> }`; extends `useTrustProject` with `addArtifact(role, format, title?)`, `addVersion(artifactId, content)`, `invite(email)` (each → client call → `refresh`).

- [ ] **Step 1: Write the failing tests**

```tsx
// mobile/__tests__/hooks/useOwnedProjects.test.tsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
jest.mock("@/api/trustClient", () => ({ listOwnedProjects: jest.fn(), createProject: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";
function Probe() { const { projects, loading } = useOwnedProjects(); return <Text>{loading ? "…" : projects.map((p) => p.title).join(",")}</Text>; }
it("lists owned projects", async () => {
  (tc.listOwnedProjects as jest.Mock).mockResolvedValue([{ id: "p1", title: "Alpha", status: "active", created_at: null }]);
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("Alpha")).toBeTruthy());
});
```

```tsx
// mobile/__tests__/hooks/useTrustProject.owner.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text, Pressable } from "react-native";
import { useTrustProject } from "@/hooks/useTrustProject";
jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn(), createArtifact: jest.fn(), createVersion: jest.fn(), invite: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";
function Probe() {
  const { addArtifact, invite } = useTrustProject("p1");
  return (<>
    <Pressable accessibilityLabel="art" onPress={() => addArtifact("cornerstone", "book")}><Text>a</Text></Pressable>
    <Pressable accessibilityLabel="inv" onPress={() => invite("e@x.z")}><Text>i</Text></Pressable>
  </>);
}
it("owner mutations call the client then refresh", async () => {
  (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "owner", artifacts: [] });
  (tc.createArtifact as jest.Mock).mockResolvedValue({ id: "a" });
  (tc.invite as jest.Mock).mockResolvedValue({ project_id: "p1", invited_email: "e@x.z", role: "reviewer", revoked_at: null });
  render(<Probe />);
  await waitFor(() => expect(tc.getProject).toHaveBeenCalledTimes(1));
  fireEvent.press(screen.getByLabelText("art"));
  await waitFor(() => expect(tc.createArtifact).toHaveBeenCalledWith("p1", { role: "cornerstone", format: "book", title: undefined }, "tok"));
  fireEvent.press(screen.getByLabelText("inv"));
  await waitFor(() => expect(tc.invite).toHaveBeenCalledWith("p1", "e@x.z", "tok"));
  await waitFor(() => expect((tc.getProject as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(3)); // refresh after each
}
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npm test -- __tests__/hooks/useOwnedProjects.test.tsx __tests__/hooks/useTrustProject.owner.test.tsx` → FAIL.

- [ ] **Step 3: Write `useOwnedProjects.ts`** (mirror `useReviews`)

```ts
// mobile/src/hooks/useOwnedProjects.ts
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { createProject, listOwnedProjects, type ProjectSummaryView, type ProjectView } from "@/api/trustClient";

export function useOwnedProjects() {
  const { accessToken, status } = useAuth();
  const [projects, setProjects] = useState<ProjectSummaryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true); setError(null);
    try { setProjects(await listOwnedProjects(accessToken)); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load your projects."); }
    finally { setLoading(false); }
  }, [accessToken]);

  const create = useCallback(async (body: { title: string; topic?: string; audience?: string; goal?: string }): Promise<ProjectView> => {
    if (!accessToken) throw new Error("Not signed in");
    const p = await createProject(body, accessToken);
    await refresh();
    return p;
  }, [accessToken, refresh]);

  useEffect(() => { if (status === "signed_in") void refresh(); else setProjects([]); }, [status, refresh]);
  return { projects, loading, error, refresh, create };
}
```

- [ ] **Step 4: Extend `useTrustProject.ts`** — add three mutations before the `return`, and include them in the returned object:

```ts
import { approveVersion, createArtifact, createVersion, getProject, invite as inviteApi, type ApprovalView, type ProjectDetailView } from "@/api/trustClient";
// ...
const addArtifact = useCallback(async (role: string, format: string, title?: string) => {
  if (!accessToken) throw new Error("Not signed in");
  const a = await createArtifact(projectId, { role, format, title }, accessToken);
  await refresh(); return a;
}, [accessToken, projectId, refresh]);

const addVersion = useCallback(async (artifactId: string, content: object) => {
  if (!accessToken) throw new Error("Not signed in");
  const v = await createVersion(artifactId, { content }, accessToken);
  await refresh(); return v;
}, [accessToken, refresh]);

const invite = useCallback(async (email: string) => {
  if (!accessToken) throw new Error("Not signed in");
  const inv = await inviteApi(projectId, email, accessToken);
  await refresh(); return inv;
}, [accessToken, projectId, refresh]);
// return { project, loading, error, refresh, approve, addArtifact, addVersion, invite };
```

- [ ] **Step 5: Run to verify pass** — same command → PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "useOwnedProjects|useTrustProject" || echo "no new type errors"
git add mobile/src/hooks/useOwnedProjects.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/hooks/useOwnedProjects.test.tsx mobile/__tests__/hooks/useTrustProject.owner.test.tsx
git commit -m "feat(trust-ui): useOwnedProjects + owner mutations on useTrustProject (ADR-037)"
```

---

### Task 3: "Projects" tab + New-Project route + nav + Help

**Files:**
- Create: `mobile/app/(tabs)/projects.tsx`, `mobile/app/trust/new.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`, `mobile/src/components/TopNavBar.tsx`, `mobile/src/constants/labels.ts`, `mobile/app/_layout.tsx`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`
- Test: `mobile/__tests__/screens/Projects.test.tsx`

**Interfaces:** consumes `useOwnedProjects`; mirrors the #345 Reviews tab + its nav/Help wiring.

- [ ] **Step 1: Read the nav/Help files** (`TopNavBar.tsx` — note the `projects` addition mirrors the `reviews` entry incl. `...(IS_DEMO ? [] : [...])`; `labels.ts` `NAV`; `_layout.tsx`; `features.ts`; `topics.ts`).

- [ ] **Step 2: Write the failing test**

```tsx
// mobile/__tests__/screens/Projects.test.tsx
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import ProjectsScreen from "@/../app/(tabs)/projects";
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (cb: () => void) => { const R = require("react"); R.useEffect(() => cb(), [cb]); } }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/hooks/useOwnedProjects", () => ({ useOwnedProjects: jest.fn() }));
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
beforeEach(() => jest.clearAllMocks());
it("lists owned projects, navigates, and New Project routes to the form", async () => {
  (useOwnedProjects as jest.Mock).mockReturnValue({ projects: [{ id: "p1", title: "Alpha", status: "active", created_at: null }], loading: false, error: null, refresh: jest.fn(), create: jest.fn() });
  render(<ProjectsScreen />);
  fireEvent.press(await screen.findByLabelText("Open project: Alpha"));
  expect(mockPush).toHaveBeenCalledWith("/trust/p1");
  fireEvent.press(screen.getByLabelText("New project"));
  expect(mockPush).toHaveBeenCalledWith("/trust/new");
});
it("shows empty state", () => {
  (useOwnedProjects as jest.Mock).mockReturnValue({ projects: [], loading: false, error: null, refresh: jest.fn(), create: jest.fn() });
  render(<ProjectsScreen />);
  expect(screen.getByText(/no projects yet/i)).toBeTruthy();
});
```

- [ ] **Step 3: Write `app/(tabs)/projects.tsx`** (mirror `reviews.tsx`; add a New-Project button)

```tsx
// mobile/app/(tabs)/projects.tsx
import { useRouter, useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { colors, radius, spacing, typography } from "@/constants/theme";

function ProjectsInner() {
  const router = useRouter();
  const { projects, loading, error, refresh } = useOwnedProjects();
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityLabel="New project" style={styles.newBtn} onPress={() => router.push("/trust/new")}>
        <Text style={styles.newBtnText}>+ New project</Text>
      </Pressable>
      {loading ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
        : error ? <View style={styles.center}><Text style={styles.error}>{error}</Text></View>
        : projects.length === 0 ? <View style={styles.center}><Text style={styles.empty}>No projects yet.</Text><Text style={styles.emptySub}>Create one to capture and validate expert knowledge.</Text></View>
        : <FlatList data={projects} keyExtractor={(p) => p.id} contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <Pressable accessibilityRole="button" accessibilityLabel={`Open project: ${item.title}`} style={styles.row} onPress={() => router.push(`/trust/${item.id}`)}>
                <View style={{ flex: 1 }}><Text style={styles.rowTitle}>{item.title}</Text><Text style={styles.rowMeta}>{item.status}</Text></View>
                <Text style={styles.chevron}>›</Text>
              </Pressable>
            )} />}
    </View>
  );
}
export default function ProjectsScreen() {
  return <RequireSignIn action="manage projects"><PageContainer><ProjectsInner /></PageContainer></RequireSignIn>;
}
const styles = StyleSheet.create({
  wrap: { flex: 1 },
  newBtn: { margin: spacing.md, backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center" },
  newBtnText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  rowTitle: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  rowMeta: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: typography.sizeXl },
  empty: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  emptySub: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
```

- [ ] **Step 4: Write `app/trust/new.tsx`** (new-project form)

```tsx
// mobile/app/trust/new.tsx
import { useRouter } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { Alert } from "@/lib/alert";
import { useOwnedProjects } from "@/hooks/useOwnedProjects";
import { ApiError } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function NewProjectScreen() {
  const router = useRouter();
  const { create } = useOwnedProjects();
  const [title, setTitle] = useState(""); const [topic, setTopic] = useState("");
  const [audience, setAudience] = useState(""); const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!title.trim()) { Alert.alert("Title required", "Give the project a title."); return; }
    setBusy(true);
    try {
      const p = await create({ title: title.trim(), topic: topic.trim() || undefined, audience: audience.trim() || undefined, goal: goal.trim() || undefined });
      router.replace(`/trust/${p.id}`);
    } catch (e) { Alert.alert("Couldn't create", e instanceof ApiError ? e.userMessage() : "Please try again."); }
    finally { setBusy(false); }
  };
  const field = (label: string, v: string, set: (s: string) => void) => (
    <View style={styles.field}><Text style={styles.label}>{label}</Text>
      <TextInput value={v} onChangeText={set} style={styles.input} placeholderTextColor={colors.textMuted} accessibilityLabel={label} /></View>
  );
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.body}><PageContainer>
      {field("Title", title, setTitle)}
      {field("Topic", topic, setTopic)}
      {field("Audience", audience, setAudience)}
      {field("Goal", goal, setGoal)}
      <Pressable accessibilityRole="button" accessibilityLabel="Create project" disabled={busy} style={styles.submit} onPress={submit}>
        <Text style={styles.submitText}>{busy ? "…" : "Create project"}</Text>
      </Pressable>
    </PageContainer></ScrollView>
  );
}
const styles = StyleSheet.create({
  scroll: { flex: 1 }, body: { padding: spacing.md, gap: spacing.md },
  field: { gap: spacing.xs }, label: { color: colors.textSecondary, fontSize: typography.sizeSm },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.sm, color: colors.text, fontSize: typography.sizeMd, backgroundColor: colors.surface },
  submit: { backgroundColor: colors.primary, borderRadius: radius.md, padding: spacing.md, alignItems: "center", marginTop: spacing.sm },
  submitText: { color: colors.primaryText, fontWeight: "700", fontSize: typography.sizeMd },
});
```

- [ ] **Step 5: Wire nav + Help** (adapt to real shapes)
  - `(tabs)/_layout.tsx`: `<Tabs.Screen name="projects" />`.
  - `TopNavBar.tsx`: add `projects` to `TABS` (a glyph, e.g. `folder`/`folder-outline`) + `ORDER` (place before `reviews`; exclude when `IS_DEMO`, same idiom as `reviews`).
  - `labels.ts`: `projects: "Projects"`.
  - `app/_layout.tsx`: `<Stack.Screen name="trust/new" options={{ title: "New project", headerBackTitle: "Projects" }} />`.
  - `features.ts`: `{ key: "projects", label: "Creating & managing projects" }`.
  - `topics.ts`: a topic `featureKey: "projects"` (title "Create & set up a project", steps: New project → add a version → invite an expert). Mirror an existing topic's shape.

- [ ] **Step 6: Run to verify pass** — `cd mobile && npm test -- __tests__/screens/Projects.test.tsx __tests__/help/coverage.test.ts` → PASS.

- [ ] **Step 7: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "projects|trust/new|TopNavBar|labels|help-content|Projects" || echo "no new type errors"
git add mobile/app/\(tabs\)/projects.tsx mobile/app/trust/new.tsx mobile/app/\(tabs\)/_layout.tsx mobile/src/components/TopNavBar.tsx mobile/src/constants/labels.ts mobile/app/_layout.tsx mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/__tests__/screens/Projects.test.tsx
git commit -m "feat(trust-ui): Projects tab + New Project form + nav + Help (ADR-037)"
```

---

### Task 4: Role-aware detail — owner actions + `recorded_via` badge

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.owner.test.tsx`

**Interfaces:** consumes the extended `useTrustProject` (`addArtifact`/`addVersion`/`invite`).

- [ ] **Step 1: Read the current `app/trust/[projectId].tsx`** (the #345 detail — the versions loop, the Approve button, the `useTrustProject` destructure).

- [ ] **Step 2: Write the failing test**

```tsx
// mobile/__tests__/screens/TrustProjectDetail.owner.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { btns?.find((b) => b.style !== "cancel")?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";
const proj = (my_role: string, is_validated = false, recorded_via: string | null = null) => ({
  project: { project: { id: "p1", title: "P", topic: null }, my_role,
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, is_validated, recorded_via }] }] },
  loading: false, error: null, refresh: jest.fn(), approve: jest.fn().mockResolvedValue({ recorded_via: "operator" }),
  addArtifact: jest.fn().mockResolvedValue({ id: "a2" }), addVersion: jest.fn().mockResolvedValue({ id: "v2" }), invite: jest.fn().mockResolvedValue({}),
});
beforeEach(() => jest.clearAllMocks());
it("owner sees Invite + Add-artifact actions; reviewer does not", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("owner"));
  const { rerender } = render(<TrustProjectDetail />);
  expect(await screen.findByLabelText("Invite an expert")).toBeTruthy();
  expect(screen.getByLabelText("Add an artifact")).toBeTruthy();
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer"));
  rerender(<TrustProjectDetail />);
  expect(screen.queryByLabelText("Invite an expert")).toBeNull();
});
it("shows the recorded_via chip on a validated version", async () => {
  (useTrustProject as jest.Mock).mockReturnValue(proj("reviewer", true, "expert_self"));
  render(<TrustProjectDetail />);
  expect(await screen.findByText(/expert-validated/i)).toBeTruthy();
});
```

- [ ] **Step 3: Extend `[projectId].tsx`** — integrate into the existing screen (do NOT rewrite unrelated parts):
  1. Destructure the new mutations: `const { project, loading, error, approve, addArtifact, addVersion, invite } = useTrustProject(String(projectId));`
  2. Add local state for an invite input + busy flags.
  3. In the version row, when `v.is_validated`, render the existing "Validated ✓" **plus** a small chip: `v.recorded_via === "expert_self" ? "expert-validated" : v.recorded_via === "operator" ? "operator-recorded" : ""`.
  4. When `project.project.my_role === "owner"` (note: `my_role` is on the detail object — read `project.my_role`), render an owner action block:
     - an **Invite** row (a `TextInput` for email + a Pressable `accessibilityLabel="Invite an expert"` → confirm/submit `invite(email)` → `Alert` result).
     - per-artifact **Add version** (a Pressable `accessibilityLabel="Add a version"` → `addVersion(artifact.id, { text: "" })`, or a small content field).
     - an **Add artifact** Pressable `accessibilityLabel="Add an artifact"` → `addArtifact("cornerstone", "book")` (MVP defaults; a form can come later).
  Wrap each action in `try/catch` → `@/lib/alert`. Keep the Approve button behavior from #345 unchanged. Theme tokens only.

  (The exact JSX mirrors the existing screen's style objects; add `ownerBlock`, `chip`, `inviteInput` styles to the StyleSheet.)

- [ ] **Step 4: Run to verify pass** — `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/screens/TrustProjectDetail.test.tsx` → PASS (owner actions present for owner, absent for reviewer; recorded_via chip shows; the #345 approve test still green).

- [ ] **Step 5: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "trust/\[projectId\]|TrustProjectDetail" || echo "no new type errors"
git add mobile/app/trust/\[projectId\].tsx mobile/__tests__/screens/TrustProjectDetail.owner.test.tsx
git commit -m "feat(trust-ui): owner actions + recorded_via badge on project detail (ADR-037)"
```

---

## Final verification

- [ ] Whole trust-ui suite: `cd mobile && npm test -- __tests__/api/trustClient.test.ts __tests__/api/trustClient.owner.test.ts __tests__/hooks/useReviews.test.tsx __tests__/hooks/useTrustProject.test.tsx __tests__/hooks/useOwnedProjects.test.tsx __tests__/hooks/useTrustProject.owner.test.tsx __tests__/screens/Reviews.test.tsx __tests__/screens/Projects.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/screens/TrustProjectDetail.owner.test.tsx __tests__/help/coverage.test.ts` — all pass.
- [ ] Full mobile typecheck clean: `cd mobile && npx tsc --noEmit -p tsconfig.json` (0 errors).
- [ ] Owner actions render only for `my_role === "owner"`; the Projects tab is `RequireSignIn`-gated and `IS_DEMO`-excluded; theme tokens only; `@/lib/alert` only.
- [ ] Manual web smoke (deferred to finishing).
