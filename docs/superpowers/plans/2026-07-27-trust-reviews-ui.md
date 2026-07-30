# Trust Reviews UI (Reviewer Read + Approve) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The mobile/web reviewer experience over the trust router — sign in → `session/sync` → a "Reviews" tab lists projects you review → project detail with per-version validated/awaiting badges → Approve (`expert_self`).

**Architecture:** Mirror the existing draft-sharing feature: a `trustClient` (copy `accountClient`), two hooks (copy `useAccount`), a tab screen + a detail Stack screen (copy `books.tsx`/`SharedWithYou`), nav wiring in 3 places, and a Help topic. Mobile-only; no backend changes. Tests are Jest+RNTL with a mocked `trustClient`/hooks.

**Tech Stack:** React Native + Expo (expo-router), TypeScript, Jest + `@testing-library/react-native`.

**Spec:** `docs/superpowers/specs/2026-07-27-trust-reviews-ui-design.md`.

## Global Constraints

- All code under `mobile/`. Files: `mobile/src/api/trustClient.ts`, `mobile/src/hooks/useReviews.ts`, `mobile/src/hooks/useTrustProject.ts`, `mobile/app/(tabs)/reviews.tsx`, `mobile/app/trust/[projectId].tsx`; edits to `mobile/app/(tabs)/_layout.tsx`, `mobile/src/components/TopNavBar.tsx`, `mobile/src/constants/labels.ts`, `mobile/app/_layout.tsx`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`.
- Theme only via `@/constants/theme` tokens — no hardcoded colors.
- Confirms/info via `@/lib/alert` `Alert` (NEVER `react-native` Alert — silent no-op on web).
- The Reviews tab is authed: wrap content in `RequireSignIn`; **exclude it from nav when `IS_DEMO`**.
- Tests run from `mobile/`: `cd mobile && npm test -- <path>`. Mock `@/api/trustClient` (or the hooks) + `expo-router` + `@/lib/alert` per the idiom in `mobile/__tests__/components/SharedWithYou.test.tsx`. RNTL `waitFor`/`findBy` default 1s (`asyncUtilTimeout`) — fine.
- No live backend in mobile tests (CLAUDE.md). No backend files touched.
- Help DoD: adding the `reviews` `FEATURES` key REQUIRES a matching topic in the SAME task, else `mobile/__tests__/help/coverage.test.ts` fails.

---

### Task 1: `trustClient.ts` — the reviewer-slice API client

**Files:**
- Create: `mobile/src/api/trustClient.ts`
- Test: `mobile/__tests__/api/trustClient.test.ts`

**Interfaces:**
- Produces: `syncSession(token)`, `getProject(projectId, token)`, `approveVersion(versionId, body, token)` + the view types. Consumed by Task 2.

- [ ] **Step 1: Write the failing test** (mock global `fetch`)

```ts
// mobile/__tests__/api/trustClient.test.ts
import { syncSession, getProject, approveVersion } from "@/api/trustClient";

const okJson = (body: unknown) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);

beforeEach(() => { jest.restoreAllMocks(); });

it("syncSession POSTs with the bearer token and returns memberships", async () => {
  const spy = jest.spyOn(global, "fetch").mockImplementation(() =>
    okJson({ account_id: "a", email: "e@x.z", memberships: [{ project_id: "p1", role: "reviewer" }] }));
  const out = await syncSession("tok");
  expect(out.memberships).toEqual([{ project_id: "p1", role: "reviewer" }]);
  const [url, init] = spy.mock.calls[0];
  expect(String(url)).toContain("/api/v1/trust/session/sync");
  expect((init as RequestInit).method).toBe("POST");
  expect((init as RequestInit).headers).toMatchObject({ Authorization: "Bearer tok" });
});

it("approveVersion POSTs the body and returns the approval", async () => {
  jest.spyOn(global, "fetch").mockImplementation(() =>
    okJson({ id: "ap", version_id: "v1", expert_name: "e@x.z", approved_at: "t", recorded_via: "expert_self" }));
  const out = await approveVersion("v1", { approved_at: "t" }, "tok");
  expect(out.recorded_via).toBe("expert_self");
});

it("throws ApiError on a non-ok response", async () => {
  jest.spyOn(global, "fetch").mockImplementation(() =>
    Promise.resolve({ ok: false, status: 403, text: () => Promise.resolve("no access") } as Response));
  await expect(getProject("p1", "tok")).rejects.toMatchObject({ status: 403 });
});
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npm test -- __tests__/api/trustClient.test.ts` → FAIL (module missing).

- [ ] **Step 3: Write the client** (mirror `mobile/src/api/accountClient.ts`)

```ts
// mobile/src/api/trustClient.ts
import { ApiError, resolveBaseUrl } from "./client";

export interface MembershipView { project_id: string; role: string }
export interface SessionSyncView { account_id: string; email: string | null; memberships: MembershipView[] }
export interface ProjectView {
  id: string; title: string; topic: string | null; audience: string | null;
  goal: string | null; status: string; created_at: string | null;
}
export interface ArtifactView {
  id: string; project_id: string; role: string; format: string; title: string | null; created_at: string | null;
}
export interface VersionSummaryView { id: string; version_no: number; created_at: string | null; is_validated: boolean }
export interface ArtifactDetailView { artifact: ArtifactView; versions: VersionSummaryView[] }
export interface ProjectDetailView { project: ProjectView; artifacts: ArtifactDetailView[]; my_role: string }
export interface ApprovalView {
  id: string; version_id: string; expert_name: string; approved_at: string; recorded_via: string;
}

async function trustFetch<T>(path: string, token: string, options?: RequestInit): Promise<T | null> {
  const res = await fetch(`${resolveBaseUrl()}/api/v1/trust${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(options?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}

export async function syncSession(token: string): Promise<SessionSyncView> {
  return (await trustFetch<SessionSyncView>("/session/sync", token, { method: "POST" })) as SessionSyncView;
}

export async function getProject(projectId: string, token: string): Promise<ProjectDetailView> {
  return (await trustFetch<ProjectDetailView>(`/projects/${projectId}`, token)) as ProjectDetailView;
}

export async function approveVersion(
  versionId: string, body: { approved_at: string; note?: string }, token: string,
): Promise<ApprovalView> {
  return (await trustFetch<ApprovalView>(
    `/versions/${versionId}/approvals`, token, { method: "POST", body: JSON.stringify(body) },
  )) as ApprovalView;
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/api/trustClient|__tests__/api/trustClient" || echo "no type errors in the new files"
git add mobile/src/api/trustClient.ts mobile/__tests__/api/trustClient.test.ts
git commit -m "feat(trust-ui): trustClient — session/sync, getProject, approveVersion (ADR-037)"
```

---

### Task 2: `useReviews` + `useTrustProject` hooks

**Files:**
- Create: `mobile/src/hooks/useReviews.ts`, `mobile/src/hooks/useTrustProject.ts`
- Test: `mobile/__tests__/hooks/useReviews.test.tsx`, `mobile/__tests__/hooks/useTrustProject.test.tsx`

**Interfaces:**
- Consumes: `trustClient` (Task 1), `useAuth` (`@/auth/AuthProvider`).
- Produces:
  - `useReviews() -> { reviews: ReviewSummary[]; loading; error; refresh }`, `ReviewSummary = { projectId, title, versionsTotal, versionsValidated }`.
  - `useTrustProject(projectId) -> { project: ProjectDetailView | null; loading; error; refresh; approve(versionId, note?) -> Promise<ApprovalView> }`.

- [ ] **Step 1: Write the failing tests** (mock `trustClient` + `useAuth`)

```tsx
// mobile/__tests__/hooks/useReviews.test.tsx
import React from "react";
import { render, screen, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";
import { useReviews } from "@/hooks/useReviews";

jest.mock("@/api/trustClient", () => ({ syncSession: jest.fn(), getProject: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";

function Probe() {
  const { reviews, loading } = useReviews();
  if (loading) return <Text>loading</Text>;
  return <Text>{reviews.map((r) => `${r.title}:${r.versionsValidated}/${r.versionsTotal}`).join(",")}</Text>;
}

it("assembles review summaries from memberships + project detail", async () => {
  (tc.syncSession as jest.Mock).mockResolvedValue({
    account_id: "a", email: "e", memberships: [{ project_id: "p1", role: "reviewer" }],
  });
  (tc.getProject as jest.Mock).mockResolvedValue({
    project: { id: "p1", title: "Stormwater" },
    my_role: "reviewer",
    artifacts: [{ artifact: { id: "art" }, versions: [
      { id: "v1", version_no: 1, is_validated: true }, { id: "v2", version_no: 2, is_validated: false },
    ] }],
  });
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("Stormwater:1/2")).toBeTruthy());
});
```

```tsx
// mobile/__tests__/hooks/useTrustProject.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Text, Pressable } from "react-native";
import { useTrustProject } from "@/hooks/useTrustProject";

jest.mock("@/api/trustClient", () => ({ getProject: jest.fn(), approveVersion: jest.fn() }));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
import * as tc from "@/api/trustClient";

function Probe() {
  const { project, approve } = useTrustProject("p1");
  return (
    <>
      <Text>{project ? project.project.title : "…"}</Text>
      <Pressable accessibilityLabel="approve" onPress={() => approve("v2")}><Text>go</Text></Pressable>
    </>
  );
}

it("loads the project and approve() calls the client then refreshes", async () => {
  (tc.getProject as jest.Mock).mockResolvedValue({ project: { id: "p1", title: "P" }, my_role: "reviewer", artifacts: [] });
  (tc.approveVersion as jest.Mock).mockResolvedValue({ id: "ap", version_id: "v2", recorded_via: "expert_self", expert_name: "e", approved_at: "t" });
  render(<Probe />);
  await waitFor(() => expect(screen.getByText("P")).toBeTruthy());
  fireEvent.press(screen.getByLabelText("approve"));
  await waitFor(() => expect(tc.approveVersion).toHaveBeenCalledWith("v2", expect.objectContaining({ approved_at: expect.any(String) }), "tok"));
  await waitFor(() => expect((tc.getProject as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2)); // refresh
});
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npm test -- __tests__/hooks/useReviews.test.tsx __tests__/hooks/useTrustProject.test.tsx` → FAIL.

- [ ] **Step 3: Write the hooks** (mirror `mobile/src/hooks/useAccount.ts`)

```ts
// mobile/src/hooks/useReviews.ts
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { getProject, syncSession } from "@/api/trustClient";

export interface ReviewSummary {
  projectId: string; title: string; versionsTotal: number; versionsValidated: number;
}

export function useReviews() {
  const { accessToken, status } = useAuth();
  const [reviews, setReviews] = useState<ReviewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      const sync = await syncSession(accessToken);
      const reviewerProjects = sync.memberships.filter((m) => m.role === "reviewer");
      const details = await Promise.all(
        reviewerProjects.map((m) => getProject(m.project_id, accessToken)),
      );
      setReviews(
        details.map((d) => {
          const versions = d.artifacts.flatMap((a) => a.versions);
          return {
            projectId: d.project.id,
            title: d.project.title,
            versionsTotal: versions.length,
            versionsValidated: versions.filter((v) => v.is_validated).length,
          };
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load your reviews.");
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setReviews([]);
  }, [status, refresh]);

  return { reviews, loading, error, refresh };
}
```

```ts
// mobile/src/hooks/useTrustProject.ts
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/auth/AuthProvider";
import { approveVersion, getProject, type ApprovalView, type ProjectDetailView } from "@/api/trustClient";

export function useTrustProject(projectId: string) {
  const { accessToken, status } = useAuth();
  const [project, setProject] = useState<ProjectDetailView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) return;
    setLoading(true);
    setError(null);
    try {
      setProject(await getProject(projectId, accessToken));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load this project.");
    } finally {
      setLoading(false);
    }
  }, [accessToken, projectId]);

  const approve = useCallback(
    async (versionId: string, note?: string): Promise<ApprovalView> => {
      if (!accessToken) throw new Error("Not signed in");
      const ap = await approveVersion(versionId, { approved_at: new Date().toISOString(), note }, accessToken);
      await refresh();
      return ap;
    },
    [accessToken, refresh],
  );

  useEffect(() => {
    if (status === "signed_in") void refresh();
    else setProject(null);
  }, [status, refresh]);

  return { project, loading, error, refresh, approve };
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/hooks/useReviews|src/hooks/useTrustProject|__tests__/hooks/useReviews|__tests__/hooks/useTrustProject" || echo "no type errors in the new files"
git add mobile/src/hooks/useReviews.ts mobile/src/hooks/useTrustProject.ts mobile/__tests__/hooks/useReviews.test.tsx mobile/__tests__/hooks/useTrustProject.test.tsx
git commit -m "feat(trust-ui): useReviews + useTrustProject hooks (ADR-037)"
```

---

### Task 3: The "Reviews" tab + nav wiring + Help

**Files:**
- Create: `mobile/app/(tabs)/reviews.tsx`
- Modify: `mobile/app/(tabs)/_layout.tsx`, `mobile/src/components/TopNavBar.tsx`, `mobile/src/constants/labels.ts`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`
- Test: `mobile/__tests__/screens/Reviews.test.tsx`

**Interfaces:**
- Consumes: `useReviews` (Task 2), `RequireSignIn`, `PageContainer`, `IS_DEMO`.

- [ ] **Step 1: Read the wiring files first.** Read `mobile/src/components/TopNavBar.tsx` (`TABS` map + `ORDER` array + the `IS_DEMO` handling if any), `mobile/src/constants/labels.ts` (`NAV`), `mobile/app/(tabs)/_layout.tsx`, `mobile/src/help-content/features.ts`, `mobile/src/help-content/topics.ts`. Mirror each file's exact shape — the snippets below are the additions, adapt to the real structure.

- [ ] **Step 2: Write the failing test**

```tsx
// mobile/__tests__/screens/Reviews.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import ReviewsScreen from "@/../app/(tabs)/reviews";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (cb: () => void) => { const R = require("react"); R.useEffect(() => cb(), [cb]); } }));
jest.mock("@/auth/RequireSignIn", () => ({ RequireSignIn: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/hooks/useReviews", () => ({ useReviews: jest.fn() }));
import { useReviews } from "@/hooks/useReviews";

beforeEach(() => { jest.clearAllMocks(); });

it("lists review projects and navigates on tap", async () => {
  (useReviews as jest.Mock).mockReturnValue({
    reviews: [{ projectId: "p1", title: "Stormwater", versionsTotal: 2, versionsValidated: 1 }],
    loading: false, error: null, refresh: jest.fn(),
  });
  render(<ReviewsScreen />);
  fireEvent.press(await screen.findByLabelText("Open project: Stormwater"));
  expect(mockPush).toHaveBeenCalledWith("/trust/p1");
});

it("shows an empty state when there are no reviews", () => {
  (useReviews as jest.Mock).mockReturnValue({ reviews: [], loading: false, error: null, refresh: jest.fn() });
  render(<ReviewsScreen />);
  expect(screen.getByText(/no projects to review/i)).toBeTruthy();
});
```

- [ ] **Step 3: Write `app/(tabs)/reviews.tsx`**

```tsx
// mobile/app/(tabs)/reviews.tsx
import { useRouter } from "expo-router";
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { RequireSignIn } from "@/auth/RequireSignIn";
import { useReviews } from "@/hooks/useReviews";
import { colors, radius, spacing, typography } from "@/constants/theme";

function ReviewsInner() {
  const router = useRouter();
  const { reviews, loading, error } = useReviews();

  if (loading) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (reviews.length === 0) {
    return (
      <View style={styles.center}>
        <Text style={styles.empty}>No projects to review yet.</Text>
        <Text style={styles.emptySub}>When an expert invites you, the project appears here.</Text>
      </View>
    );
  }
  return (
    <FlatList
      data={reviews}
      keyExtractor={(r) => r.projectId}
      contentContainerStyle={styles.list}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open project: ${item.title}`}
          style={styles.row}
          onPress={() => router.push(`/trust/${item.projectId}`)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{item.title}</Text>
            <Text style={styles.rowMeta}>{item.versionsValidated}/{item.versionsTotal} versions validated</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )}
    />
  );
}

export default function ReviewsScreen() {
  return (
    <RequireSignIn action="review projects">
      <PageContainer>
        <ReviewsInner />
      </PageContainer>
    </RequireSignIn>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  list: { padding: spacing.md, gap: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  rowTitle: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  rowMeta: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: 2 },
  chevron: { color: colors.textMuted, fontSize: typography.sizeXl },
  empty: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  emptySub: { color: colors.textSecondary, fontSize: typography.sizeSm, marginTop: spacing.xs, textAlign: "center" },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
```

- [ ] **Step 4: Wire nav + Help** (adapt to the real file shapes read in Step 1)
  - `mobile/app/(tabs)/_layout.tsx`: add `<Tabs.Screen name="reviews" />` alongside the others.
  - `mobile/src/components/TopNavBar.tsx`: add `reviews` to the `TABS` map (choose an existing icon glyph, e.g. a clipboard/check-seal from the icon set already imported) and to the `ORDER` array. **If `ORDER` is filtered by `IS_DEMO` anywhere, exclude `reviews` in demo; otherwise add `IS_DEMO` guard so `reviews` is omitted from `ORDER` when `IS_DEMO`.**
  - `mobile/src/constants/labels.ts`: add `reviews: "Reviews"` to `NAV`.
  - `mobile/src/help-content/features.ts`: add `{ key: "reviews", label: "Reviewing & approving projects" }` to `FEATURES`.
  - `mobile/src/help-content/topics.ts`: add a `HELP_TOPICS` entry with `featureKey: "reviews"`, a title ("Review & approve a project"), keywords (`["review","approve","expert","validate"]`), and `blocks` (a `text` intro + a `steps` block: open Reviews → pick a project → Approve a version). Follow an existing topic's exact shape.

- [ ] **Step 5: Run to verify pass** — `cd mobile && npm test -- __tests__/screens/Reviews.test.tsx __tests__/help/coverage.test.ts` → PASS (screen + Help gate green).

- [ ] **Step 6: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "app/\(tabs\)/reviews|TopNavBar|labels|help-content|__tests__/screens/Reviews" || echo "no type errors in the touched files"
git add mobile/app/\(tabs\)/reviews.tsx mobile/app/\(tabs\)/_layout.tsx mobile/src/components/TopNavBar.tsx mobile/src/constants/labels.ts mobile/src/help-content/features.ts mobile/src/help-content/topics.ts mobile/__tests__/screens/Reviews.test.tsx
git commit -m "feat(trust-ui): Reviews tab + nav wiring + Help topic (ADR-037)"
```

---

### Task 4: Project detail + Approve (`app/trust/[projectId].tsx`)

**Files:**
- Create: `mobile/app/trust/[projectId].tsx`
- Modify: `mobile/app/_layout.tsx` (register the Stack screen)
- Test: `mobile/__tests__/screens/TrustProjectDetail.test.tsx`

**Interfaces:**
- Consumes: `useTrustProject` (Task 2), `@/lib/alert`.

- [ ] **Step 1: Write the failing test** (mock the hook + `@/lib/alert` to auto-confirm)

```tsx
// mobile/__tests__/screens/TrustProjectDetail.test.tsx
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import TrustProjectDetail from "@/../app/trust/[projectId]";

jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ projectId: "p1" }), useRouter: () => ({ back: jest.fn() }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: jest.fn() }));
// auto-press the non-cancel button of any Alert confirm
jest.mock("@/lib/alert", () => ({ Alert: { alert: (_t: string, _m: string, btns?: { style?: string; onPress?: () => void }[]) => { const b = btns?.find((x) => x.style !== "cancel"); b?.onPress?.(); } } }));
import { useTrustProject } from "@/hooks/useTrustProject";

const base = {
  project: { project: { id: "p1", title: "Stormwater", topic: null }, my_role: "reviewer",
    artifacts: [{ artifact: { id: "art", title: "Guide", role: "cornerstone", format: "book" },
      versions: [{ id: "v1", version_no: 1, is_validated: true }, { id: "v2", version_no: 2, is_validated: false }] }] },
  loading: false, error: null, refresh: jest.fn(),
};

beforeEach(() => { jest.clearAllMocks(); });

it("shows validated + awaiting badges and approves an awaiting version", async () => {
  const approve = jest.fn().mockResolvedValue({ recorded_via: "expert_self" });
  (useTrustProject as jest.Mock).mockReturnValue({ ...base, approve });
  render(<TrustProjectDetail />);
  expect(await screen.findByText("Stormwater")).toBeTruthy();
  expect(screen.getByLabelText("Version 1 validated")).toBeTruthy();
  fireEvent.press(screen.getByLabelText("Approve version 2"));
  await waitFor(() => expect(approve).toHaveBeenCalledWith("v2"));
});
```

- [ ] **Step 2: Run to verify failure** — `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.test.tsx` → FAIL.

- [ ] **Step 3: Write `app/trust/[projectId].tsx`**

```tsx
// mobile/app/trust/[projectId].tsx
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { PageContainer } from "@/components/PageContainer";
import { Alert } from "@/lib/alert";
import { useTrustProject } from "@/hooks/useTrustProject";
import { ApiError } from "@/api/client";
import { colors, radius, spacing, typography } from "@/constants/theme";

export default function TrustProjectDetail() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>();
  const { project, loading, error, approve } = useTrustProject(String(projectId));
  const [busy, setBusy] = useState<string | null>(null);

  if (loading && !project) return <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>;
  if (error) return <View style={styles.center}><Text style={styles.error}>{error}</Text></View>;
  if (!project) return null;

  const onApprove = (versionId: string, versionNo: number) => {
    Alert.alert(
      "Record approval",
      `Record your approval of v${versionNo}? It is logged as expert-validated by you.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve",
          onPress: async () => {
            setBusy(versionId);
            try {
              const ap = await approve(versionId);
              Alert.alert("Approved", ap.recorded_via === "expert_self" ? "Recorded as expert-validated." : "Approval recorded.");
            } catch (e) {
              Alert.alert("Couldn't approve", e instanceof ApiError ? e.userMessage() : "Please try again.");
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );
  };

  return (
    <PageContainer>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.title}>{project.project.title}</Text>
        {project.project.topic ? <Text style={styles.topic}>{project.project.topic}</Text> : null}
        {project.artifacts.map(({ artifact, versions }) => (
          <View key={artifact.id} style={styles.artifact}>
            <Text style={styles.artifactTitle}>{artifact.title ?? artifact.format}</Text>
            {versions.map((v) => (
              <View key={v.id} style={styles.versionRow}>
                <Text style={styles.versionLabel}>v{v.version_no}</Text>
                {v.is_validated ? (
                  <Text accessibilityLabel={`Version ${v.version_no} validated`} style={styles.validated}>Validated ✓</Text>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Approve version ${v.version_no}`}
                    disabled={busy === v.id}
                    style={styles.approveBtn}
                    onPress={() => onApprove(v.id, v.version_no)}
                  >
                    <Text style={styles.approveText}>{busy === v.id ? "…" : "Approve"}</Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </PageContainer>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  body: { padding: spacing.md, gap: spacing.md },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  topic: { color: colors.textSecondary, fontSize: typography.sizeMd },
  artifact: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.sm },
  artifactTitle: { color: colors.text, fontSize: typography.sizeLg, fontWeight: "600" },
  versionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  versionLabel: { color: colors.textSecondary, fontSize: typography.sizeMd },
  validated: { color: colors.growth, fontSize: typography.sizeSm, fontWeight: "700" },
  approveBtn: { backgroundColor: colors.primary, borderRadius: radius.sm, paddingVertical: spacing.xs, paddingHorizontal: spacing.md },
  approveText: { color: colors.primaryText, fontSize: typography.sizeSm, fontWeight: "700" },
  error: { color: colors.error, fontSize: typography.sizeMd, textAlign: "center" },
});
```

- [ ] **Step 4: Register the Stack screen** in `mobile/app/_layout.tsx` — add alongside the other `Stack.Screen`s:

```tsx
<Stack.Screen name="trust/[projectId]" options={{ title: "Project", headerBackTitle: "Reviews" }} />
```

- [ ] **Step 5: Run to verify pass** — `cd mobile && npm test -- __tests__/screens/TrustProjectDetail.test.tsx` → PASS.

- [ ] **Step 6: Typecheck + commit**

```bash
cd mobile && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "app/trust/|app/_layout|__tests__/screens/TrustProjectDetail" || echo "no type errors in the touched files"
git add mobile/app/trust/\[projectId\].tsx mobile/app/_layout.tsx mobile/__tests__/screens/TrustProjectDetail.test.tsx
git commit -m "feat(trust-ui): project detail + approve screen (ADR-037)"
```

---

## Final verification

- [ ] Whole trust-ui test set: `cd mobile && npm test -- __tests__/api/trustClient.test.ts __tests__/hooks/useReviews.test.tsx __tests__/hooks/useTrustProject.test.tsx __tests__/screens/Reviews.test.tsx __tests__/screens/TrustProjectDetail.test.tsx __tests__/help/coverage.test.ts` — all pass.
- [ ] Full mobile typecheck touches no new errors: `cd mobile && npx tsc --noEmit -p tsconfig.json` (compare against the pre-existing baseline; the new files add none).
- [ ] The Reviews tab is `RequireSignIn`-gated and excluded from nav when `IS_DEMO`.
- [ ] No hardcoded colors (theme tokens only); confirms via `@/lib/alert`.
- [ ] Manual web smoke (deferred to finishing): the tab renders, signed-out shows the sign-in card, demo hides the tab.
