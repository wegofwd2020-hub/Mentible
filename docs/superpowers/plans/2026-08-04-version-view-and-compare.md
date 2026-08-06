# Version View Affordance, Timestamps + Compare — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every version row show a timestamp + an explicit `View` control, and add a Compare-2-versions side-by-side screen.

**Architecture:** Client-only (no backend). `app/trust/[projectId].tsx` version rows gain a timestamp + `View`; a per-artifact `Compare…` mode selects 2 versions and pushes a new `app/trust/compare/[versionId].tsx` screen that fetches both via the existing `getVersion` and renders them responsively side-by-side with section-level change tint.

**Tech Stack:** React Native + Expo Router · TypeScript · Jest + RNTL.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-04-version-view-and-compare-design.md`.
- NO backend change, NO migration. `getVersion` + `VersionSummaryView.created_at` already exist.
- Follows the **selected theme** — `useThemedStyles(makeStyles)` with `(c: Palette)`; do NOT wrap the compare screen in a forced `SmeThemeScope` (ADR-038 O1 was reversed, #375–377).
- Every RN literal in `makeStyles` needs `as const`; Fraunces headings via `FRAUNCES.*` without `fontWeight`; a scene-root `PageContainer` carries `flex: 1`.
- Compare is scoped to ONE artifact's versions; the `Compare` button activates only at exactly 2 selected.
- Row-tap → `onOpenVersion(artifactId, versionId)` wiring stays; `View`/`Approve`/`Unapprove` are separate sibling tap targets (don't nest pressables).
- Run REAL `npx tsc --noEmit` (Jest doesn't typecheck). jest.mock factory consts need a `mock` prefix; the screen-under-test import path matches the existing `TrustProjectDetail`/`TrustVersion` tests (`@/../app/...`).
- Interfaces (already on this branch's base): `getVersion(versionId, token): Promise<VersionDetailView>`; `VersionDetailView { id, artifact_id, version_no, content: { sections: DraftSection[] }, generation_meta, is_validated, recorded_via, created_at }`; `DraftSection { heading, body, source_ids }`; `useTrustProject(projectId)` exposes `project` (with `inputs`, `artifacts[].versions[]`).

---

### Task 1: Version-row timestamp + explicit `View` (both panels)

**Files:**
- Create: `mobile/src/lib/versionTimestamp.ts`
- Modify: `mobile/app/trust/[projectId].tsx` (DraftsPanel + FeedbackPanel version rows; styles)
- Test: `mobile/__tests__/lib/versionTimestamp.test.ts` (new) + `mobile/__tests__/screens/TrustProjectDetail.viewrow.test.tsx` (new)

**Interfaces:**
- Produces: `versionTimestamp(createdAt: string | null): string` — date + time, `""` on null/invalid. A `View` control on every version row (both panels) with `accessibilityLabel={`View version ${n}`}` → same `onOpenVersion(artifactId, versionId)`.

- [ ] **Step 1: Write the failing helper test**

Create `mobile/__tests__/lib/versionTimestamp.test.ts`:

```ts
import { versionTimestamp } from "@/lib/versionTimestamp";

describe("versionTimestamp", () => {
  it("returns '' for null/invalid", () => {
    expect(versionTimestamp(null)).toBe("");
    expect(versionTimestamp("not-a-date")).toBe("");
  });
  it("returns a non-empty date+time string for a valid ISO", () => {
    const s = versionTimestamp("2026-08-04T14:14:00Z");
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toBe("");
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/lib/versionTimestamp.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the helper**

`mobile/src/lib/versionTimestamp.ts`:

```ts
// Date + time label for a version row (multiple same-day regenerations must be distinguishable).
export function versionTimestamp(createdAt: string | null): string {
  if (!createdAt) return "";
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
}
```

- [ ] **Step 4: Write the failing row test**

Create `mobile/__tests__/screens/TrustProjectDetail.viewrow.test.tsx`, modelled on the existing `TrustProjectDetail.test.tsx` mock/setup (mock `expo-router` with a `mockPush`, `useTrustProject`, auth). Seed a project (`my_role:"owner"`) with one artifact + one version `{ id:"v1", version_no:1, created_at:"2026-08-04T14:14:00Z", is_validated:false, recorded_via:null }`. On the Drafts tab:

```ts
expect(getByText(/v1/)).toBeTruthy();
// timestamp shown
expect(getByText(/2026|AM|PM|:/)).toBeTruthy();
// explicit View affordance opens the viewer
fireEvent.press(getByLabelText("View version 1"));
expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
  pathname: "/trust/version/[versionId]",
  params: expect.objectContaining({ versionId: "v1" }),
}));
```

- [ ] **Step 5: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.viewrow.test.tsx`
Expected: FAIL (no "View version 1" label).

- [ ] **Step 6: Add timestamp + View to both panels' rows**

In `mobile/app/trust/[projectId].tsx`, import `versionTimestamp` from `@/lib/versionTimestamp`. In BOTH `DraftsPanel` and `FeedbackPanel`, inside each version row (keep the whole-row `Pressable` + its `onPress={onOpenVersion}`), restructure the row content to three parts:
- left: `v{version_no}` + a timestamp `Text` (`versionTimestamp(v.created_at)`, styled muted/small; render only if non-empty).
- middle: the existing status (`Validated ✓` + chip, or `Awaiting review`; Feedback keeps its `Approve`/`Unapprove` controls as siblings — unchanged).
- right: an explicit **`View`** control — a small bordered/pill `Pressable` (or a `Text` styled as a button) with `accessibilityRole="button"`, `accessibilityLabel={`View version ${v.version_no}`}`, `onPress={() => onOpenVersion(artifact.id, v.id)}`. In Feedback, render `View` as a sibling of `Approve`/`Unapprove` (not nested).

Add styles (`versionRowTs`, `viewBtn`, `viewBtnText`) with `as const` on literals; `viewBtn` should read as tappable (border + padding, theme colors). Keep `versionRow` layout.

- [ ] **Step 7: Run — verify pass + full TrustProjectDetail suite + tsc**

Run: `cd mobile && npx jest __tests__/lib/versionTimestamp.test.ts __tests__/screens/TrustProjectDetail && npx tsc --noEmit`
Expected: PASS (new + existing detail/generate/sources/owner/journey/open-version/picker), tsc clean. If an existing test asserted the old bare-row shape, update it minimally (note in report).

- [ ] **Step 8: Commit**

```bash
git add mobile/src/lib/versionTimestamp.ts "mobile/app/trust/[projectId].tsx" mobile/__tests__/lib/versionTimestamp.test.ts mobile/__tests__/screens/TrustProjectDetail.viewrow.test.tsx
git commit -m "feat(trust): version rows show timestamp + explicit View"
```

---

### Task 2: Compare selection mode (pick 2 → push compare route)

**Files:**
- Modify: `mobile/app/trust/[projectId].tsx`
- Test: `mobile/__tests__/screens/TrustProjectDetail.compare.test.tsx` (new)

**Interfaces:**
- Consumes: `useRouter().push`.
- Produces: per-artifact `Compare…` toggle → compare mode (checkboxes on that artifact's rows) → `Compare` button (enabled only at exactly 2 selected) → `router.push({ pathname: "/trust/compare/[versionId]", params: { versionId: aId, b: bId, artifactId, projectId } })`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustProjectDetail.compare.test.tsx` (mock setup like Task 1, `mockPush`). Seed one artifact with 3 versions (v1/v2/v3). On the Drafts tab:

```ts
fireEvent.press(getByLabelText("Compare versions"));           // enter compare mode for the artifact
// compare button disabled until 2 selected
fireEvent.press(getByLabelText("Select version 2"));
fireEvent.press(getByLabelText("Select version 3"));
fireEvent.press(getByLabelText("Compare selected versions"));
expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({
  pathname: "/trust/compare/[versionId]",
  params: expect.objectContaining({ versionId: "v2", b: "v3", artifactId: expect.any(String), projectId: expect.any(String) }),
}));
```

Add a second assertion: with only 1 selected, `Compare selected versions` is disabled (pressing it does not push).

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail.compare.test.tsx`
Expected: FAIL (no compare controls).

- [ ] **Step 3: Add compare mode**

In `TrustProjectDetailInner`, add state:

```tsx
  const [compareArtifactId, setCompareArtifactId] = useState<string | null>(null);
  const [compareSel, setCompareSel] = useState<string[]>([]);

  const toggleCompareMode = (artifactId: string) => {
    setCompareArtifactId((cur) => (cur === artifactId ? null : artifactId));
    setCompareSel([]);
  };
  const toggleCompareSel = (versionId: string) =>
    setCompareSel((cur) =>
      cur.includes(versionId) ? cur.filter((x) => x !== versionId) : cur.length < 2 ? [...cur, versionId] : cur,
    );
  const onCompare = (artifactId: string) => {
    if (compareSel.length !== 2) return;
    router.push({
      pathname: "/trust/compare/[versionId]",
      params: { versionId: compareSel[0], b: compareSel[1], artifactId, projectId: String(projectId) },
    });
  };
```

Thread `compareArtifactId`, `compareSel`, `toggleCompareMode`, `toggleCompareSel`, `onCompare` into `DraftsPanel` and `FeedbackPanel` (add to prop types). In each panel, per artifact:
- Below the version list, a `Compare…` `Pressable` (`accessibilityLabel="Compare versions"`, `onPress={() => toggleCompareMode(artifact.id)}`) — show only when the artifact has ≥2 versions.
- When `compareArtifactId === artifact.id`: render a checkbox control on each version row (`accessibilityRole="checkbox"`, `accessibilityLabel={`Select version ${v.version_no}`}`, `accessibilityState={{ checked: compareSel.includes(v.id) }}`, `onPress={() => toggleCompareSel(v.id)}`), and a `Compare selected versions` button (`accessibilityLabel="Compare selected versions"`, `disabled={compareSel.length !== 2}`, `onPress={() => onCompare(artifact.id)}`) + a `Cancel` that calls `toggleCompareMode(artifact.id)`.

Add styles (`compareBtn`, `checkbox`, `checkboxOn`) with `as const`.

- [ ] **Step 4: Run — verify pass + full TrustProjectDetail suite + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustProjectDetail && npx tsc --noEmit`
Expected: PASS (compare + all existing), tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/[projectId].tsx" mobile/__tests__/screens/TrustProjectDetail.compare.test.tsx
git commit -m "feat(trust): compare mode — select 2 versions to compare"
```

---

### Task 3: Compare screen (responsive side-by-side + section highlight)

**Files:**
- Create: `mobile/app/trust/compare/[versionId].tsx`
- Test: `mobile/__tests__/screens/TrustCompare.test.tsx` (new)

**Interfaces:**
- Consumes: `getVersion` (fetch A + B), `useTrustProject(projectId).project.inputs` (citation labels), `useAuth().accessToken`, `useWindowDimensions`.
- Produces: route `/trust/compare/[versionId]` reading params `versionId` (A), `b` (B), `artifactId`, `projectId`.

- [ ] **Step 1: Write the failing test**

Create `mobile/__tests__/screens/TrustCompare.test.tsx`:

```tsx
import React from "react";
import { render, waitFor } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ versionId: "vA", b: "vB", artifactId: "a1", projectId: "p1" }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock("@/auth/AuthProvider", () => ({ useAuth: () => ({ accessToken: "tok", status: "signed_in" }) }));
jest.mock("@/hooks/useTrustProject", () => ({ useTrustProject: () => ({ project: { inputs: [] } }) }));
const mockGetVersion = jest.fn(async (id: string) =>
  id === "vA"
    ? { id: "vA", artifact_id: "a1", version_no: 1, content: { sections: [{ heading: "H", body: "old body", source_ids: [] }] }, generation_meta: null, is_validated: false, recorded_via: null, created_at: null }
    : { id: "vB", artifact_id: "a1", version_no: 2, content: { sections: [{ heading: "H", body: "new body", source_ids: [] }, { heading: "Extra", body: "added", source_ids: [] }] }, generation_meta: null, is_validated: true, recorded_via: "operator", created_at: null },
);
jest.mock("@/api/trustClient", () => ({ getVersion: (id: string) => mockGetVersion(id) }));

import TrustCompare from "@/../app/trust/compare/[versionId]";

it("renders both versions and marks changed + added sections", async () => {
  const { getByText, getByTestId } = render(<TrustCompare />);
  await waitFor(() => expect(getByText("old body")).toBeTruthy());
  expect(getByText("new body")).toBeTruthy();
  expect(getByTestId("section-0-changed")).toBeTruthy();  // H body differs
  expect(getByTestId("section-1-added")).toBeTruthy();     // Extra only in B
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `cd mobile && npx jest __tests__/screens/TrustCompare.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Create the compare screen**

Create `mobile/app/trust/compare/[versionId].tsx`. Requirements:
- Read params `versionId` (A), `b` (B), `artifactId`, `projectId` via `useLocalSearchParams`.
- Fetch both: `Promise.all([getVersion(A, token), getVersion(B, token)])` in an effect with an unmount guard (`let live = true`); loading → `ActivityIndicator`; on error → a friendly `Text` ("Couldn't load one of the versions.") + a `Back`.
- Header: `v{A.version_no} · {versionTimestamp(A.created_at)} ↔ v{B.version_no} · {versionTimestamp(B.created_at)}` with each side's validated/`recorded_via` note.
- Compute aligned rows: `const n = Math.max(aSecs.length, bSecs.length)` over `(A.content?.sections ?? [])` / `(B.content?.sections ?? [])`; for each `i` derive `status`:
  - `a && b`: `a.heading !== b.heading || a.body !== b.body ? "changed" : "same"`.
  - `a && !b`: `"removed"`. `!a && b`: `"added"`.
- Layout: `const wide = useWindowDimensions().width >= 700`. Wide → each aligned row is a horizontal `View` (two section cells A | B); narrow → for each row render A cell then B cell stacked. Section cell renders heading + body + citation chips (map `source_ids` → `labelFor` from `project.inputs`, same as the viewer). Missing side → a muted "— no section —" placeholder cell.
- Each rendered section cell (or its row wrapper) carries `testID={`section-${i}-${status}`}` and a theme-aware tint per status (changed / added / removed / same → subtle backgrounds from the palette).
- `useThemedStyles(makeStyles)` with `(c: Palette)`; NO forced `SmeThemeScope`. `PageContainer` (if used as scene root) carries `flex: 1`. A `Back` control (`router.back()`).

Keep the file focused; reuse the viewer's section styling idiom (heading Fraunces optional, body text, cite chips) but this is a distinct screen.

- [ ] **Step 4: Run — verify pass + tsc**

Run: `cd mobile && npx jest __tests__/screens/TrustCompare.test.tsx && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/trust/compare/[versionId].tsx" mobile/__tests__/screens/TrustCompare.test.tsx
git commit -m "feat(trust): compare screen — responsive side-by-side with section highlight"
```

---

## Final verification (after all tasks)

- [ ] `cd mobile && npx jest && npx tsc --noEmit` — full suite green, tsc clean.
- [ ] Manual reasoning: from Drafts/Feedback, a `View` opens the #370 viewer; `Compare…` → pick 2 → the compare screen shows both, changed section tinted, added/removed handled; wide vs narrow layouts both render.
- [ ] PR body: mobile/web only — **no backend change / no migration**; ship = web redeploy (+ APK if native wanted).

## Self-review

- **Spec coverage:** View affordance + timestamp (T1), Compare selection (T2), compare screen responsive + highlight (T3). Non-goals (word-diff, edit-from-compare, cross-artifact, backend) excluded. All spec sections mapped.
- **Type consistency:** `versionTimestamp` signature identical in helper + both panels; the compare route `pathname: "/trust/compare/[versionId]"` + params `{ versionId, b, artifactId, projectId }` identical in T2's push and T3's `useLocalSearchParams`; `getVersion`/`VersionDetailView`/`DraftSection` reused unchanged.
- **Placeholders:** none — helper + route code literal; the panel-edit steps (T1 step 6, T2 step 3) name the exact controls, labels, and state contract the tests assert.
