# Open Shelves — Sources Management UI (ADR-028, plan 3 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing **Sources management** surface for Open Shelves (spec P0-1): a `useOpenShelves` hook over the plan-2 store, presentational Add/List components, a `shelves` screen that adds a source by URL (with the P0-8 add-time warning and the P0-9 no-auth message), lists sources with entry count + last-refreshed, refreshes and removes them — plus nav wiring and the required Help topic.

**Architecture:** A React binding layer in `mobile/src/openshelves/` + one expo-router screen. `useOpenShelves` wraps the plan-2 `feedStore` (add/remove/refresh/list) and owns list + loading + error state. `AddSourceForm` and `SourceRow` are pure presentational components (props + callbacks, no store access) so they test under RNTL without mocks. `shelves.tsx` composes them, routes errors to copy (an `authRequired` FeedSourceError → the "authenticated repos aren't supported" message), and gates the actual add behind an `@/lib/alert` confirm carrying the neutral-conduit warning. Reuses the app's `PageContainer`/theme/nav patterns.

**Tech Stack:** React Native + expo-router, `@/lib/alert` (cross-platform Alert shim), `@testing-library/react-native`, jest-expo. Branch: `feat/open-shelves` (localhost-only; never deployed).

## Global Constraints

- **Location:** hook + components in `mobile/src/openshelves/`; the screen at `mobile/app/(tabs)/shelves.tsx`; component/hook tests in `mobile/src/openshelves/__tests__/` (`*.test.tsx`); the screen test in `mobile/__tests__/app/`. Commands run from `mobile/`.
- **Dialogs go through `@/lib/alert`**, never `react-native`'s `Alert` directly — RN-web no-ops `Alert.alert`, so a raw import silently does nothing on web (the confirm's `onPress` never fires). Import `Alert` from `@/lib/alert`.
- **No direct store/network in components:** `AddSourceForm`/`SourceRow` receive data + callbacks via props only. Only `useOpenShelves` imports `feedStore`; only `feedStore` touches the network. Tests mock `@/openshelves/feedStore` for the hook, and pass plain props for the components.
- **Error → copy mapping (spec P0-9):** a caught `FeedSourceError` with `authRequired === true` renders **"Authenticated repos aren't supported yet."**; any other `FeedSourceError`/`FeedParseError` renders its `.message`. Never show a raw stack.
- **Add-time warning (spec P0-8, neutral conduit / D6):** before a **user-added** source is saved, show a confirm (via `@/lib/alert`) stating user-added libraries are outside Mentible's curation and are the user's responsibility; only add on confirm. Mentible does **not** block or inspect the source.
- **No auth gating on the feature:** Open Shelves works with no account (spec: "no account, no key, no setup"). Do **not** wrap the screen in `RequireSignIn`.
- **Help is part of done (CLAUDE.md):** this is a user-facing feature, so the same change adds a `FEATURES` key `"open-shelves"` and a `HELP_TOPICS` topic with `featureKey: "open-shelves"`. The coverage gate (`mobile/__tests__/help/coverage.test.ts`) fails otherwise.
- **RNTL test notes:** components render under `@testing-library/react-native` (no DOM). `findBy*`/`waitFor` obey RNTL's `asyncUtilTimeout` (~1000ms default), not `jest.setTimeout` — keep async assertions fast/deterministic by resolving mocked promises immediately.
- **Scope:** Sources *management* only. Browsing the catalog (entry list/detail), starter list, downloads, and filters are later plans — do not build them here.

---

### Task 1: `useOpenShelves` hook

**Files:**
- Create: `mobile/src/openshelves/useOpenShelves.ts`
- Test: `mobile/src/openshelves/__tests__/useOpenShelves.test.tsx`

**Interfaces:**
- Consumes: `listSources` from `./feedSourcesStore`; `addSource`, `removeSource`, `refreshSource`, `refreshAll` from `./feedStore`; `FeedSource` from `./types`.
- Produces:
  - `useOpenShelves(): { sources: FeedSource[]; loading: boolean; busy: boolean; error: string | null; reload(): Promise<void>; add(url: string): Promise<boolean>; remove(id: string): Promise<void>; refresh(id: string): Promise<void>; refreshAllSources(): Promise<void> }`
  - `add` returns `true` on success (source added, list reloaded, `error` cleared) and `false` on failure (with `error` set to the mapped message); it never throws. `busy` is true while any mutation is in flight.

**Notes for the implementer:**
- Map errors with a small local helper: `authRequired` on a `FeedSourceError` → `"Authenticated repos aren't supported yet."`; else `(err as Error).message ?? "Something went wrong."`. Import `FeedSourceError` from `./errors`.
- On mount, call `reload()` (load `listSources()` into state, `loading` false when done).

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/useOpenShelves.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useOpenShelves } from "../useOpenShelves";
import { FeedSourceError } from "../errors";

jest.mock("../feedSourcesStore", () => ({ listSources: jest.fn() }));
jest.mock("../feedStore", () => ({
  addSource: jest.fn(), removeSource: jest.fn(), refreshSource: jest.fn(), refreshAll: jest.fn(),
}));
import { listSources } from "../feedSourcesStore";
import { addSource, removeSource } from "../feedStore";

const src = (id: string) => ({ id, url: `https://ex.org/${id}`, title: id, addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 1 });

beforeEach(() => jest.clearAllMocks());

test("loads sources on mount", async () => {
  (listSources as jest.Mock).mockResolvedValue([src("a")]);
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.sources.map((s) => s.id)).toEqual(["a"]);
});

test("add success reloads the list and returns true", async () => {
  (listSources as jest.Mock).mockResolvedValueOnce([]).mockResolvedValueOnce([src("a")]);
  (addSource as jest.Mock).mockResolvedValue(src("a"));
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.add("https://ex.org/a"); });
  expect(ok).toBe(true);
  expect(result.current.sources.map((s) => s.id)).toEqual(["a"]);
  expect(result.current.error).toBeNull();
});

test("add maps an authRequired error and returns false", async () => {
  (listSources as jest.Mock).mockResolvedValue([]);
  (addSource as jest.Mock).mockRejectedValue(new FeedSourceError("x", { authRequired: true }));
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let ok: boolean | undefined;
  await act(async () => { ok = await result.current.add("https://ex.org/a"); });
  expect(ok).toBe(false);
  expect(result.current.error).toBe("Authenticated repos aren't supported yet.");
});

test("remove reloads the list", async () => {
  (listSources as jest.Mock).mockResolvedValueOnce([src("a")]).mockResolvedValueOnce([]);
  (removeSource as jest.Mock).mockResolvedValue(undefined);
  const { result } = renderHook(() => useOpenShelves());
  await waitFor(() => expect(result.current.sources.length).toBe(1));
  await act(async () => { await result.current.remove("a"); });
  expect(result.current.sources).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/useOpenShelves.test.tsx`
Expected: FAIL — cannot find module `../useOpenShelves`.

- [ ] **Step 3: Write the implementation**

```tsx
// mobile/src/openshelves/useOpenShelves.ts
// React binding over the plan-2 feedStore: owns the sources list + loading/busy/
// error state for the Sources screen. The only openshelves module that touches
// the store; components stay presentational.
import { useCallback, useEffect, useState } from "react";
import type { FeedSource } from "./types";
import { FeedSourceError } from "./errors";
import { listSources } from "./feedSourcesStore";
import { addSource, removeSource, refreshSource, refreshAll } from "./feedStore";

function toMessage(err: unknown): string {
  if (err instanceof FeedSourceError && err.authRequired) {
    return "Authenticated repos aren't supported yet.";
  }
  return (err as Error)?.message ?? "Something went wrong.";
}

export function useOpenShelves() {
  const [sources, setSources] = useState<FeedSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setSources(await listSources());
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const add = useCallback(async (url: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await addSource(url);
      await reload();
      return true;
    } catch (err) {
      setError(toMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }, [reload]);

  const remove = useCallback(async (id: string) => {
    setBusy(true);
    try { await removeSource(id); await reload(); }
    finally { setBusy(false); }
  }, [reload]);

  const refresh = useCallback(async (id: string) => {
    setBusy(true);
    setError(null);
    try { await refreshSource(id); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [reload]);

  const refreshAllSources = useCallback(async () => {
    setBusy(true);
    try { await refreshAll(); await reload(); }
    finally { setBusy(false); }
  }, [reload]);

  return { sources, loading, busy, error, reload, add, remove, refresh, refreshAllSources };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/useOpenShelves.test.tsx`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/useOpenShelves.ts mobile/src/openshelves/__tests__/useOpenShelves.test.tsx
git commit -m "feat(open-shelves): useOpenShelves hook (list/add/remove/refresh + error mapping)"
```

---

### Task 2: `AddSourceForm` component

**Files:**
- Create: `mobile/src/openshelves/AddSourceForm.tsx`
- Test: `mobile/src/openshelves/__tests__/AddSourceForm.test.tsx`

**Interfaces:**
- Produces: `AddSourceForm(props: { onSubmit: (url: string) => void; busy?: boolean; error?: string | null }): JSX.Element` — a URL `TextInput` (`testID="add-source-input"`, `autoCapitalize="none"`, `keyboardType="url"`), an "Add source" button (`testID="add-source-submit"`) that calls `onSubmit(trimmedUrl)` when the field is non-empty, a visible warning line (the neutral-conduit copy), and, when `error`, an error line (`testID="add-source-error"`).

**Notes for the implementer:** presentational only — no store, no alert. The parent owns validation/persistence; this just collects the URL and shows `error`/`busy`. Use the theme tokens (`@/constants/theme`).

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/AddSourceForm.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { AddSourceForm } from "../AddSourceForm";

test("submits the trimmed url", () => {
  const onSubmit = jest.fn();
  const { getByTestId } = render(<AddSourceForm onSubmit={onSubmit} />);
  fireEvent.changeText(getByTestId("add-source-input"), "  https://ex.org/f  ");
  fireEvent.press(getByTestId("add-source-submit"));
  expect(onSubmit).toHaveBeenCalledWith("https://ex.org/f");
});

test("does not submit an empty url", () => {
  const onSubmit = jest.fn();
  const { getByTestId } = render(<AddSourceForm onSubmit={onSubmit} />);
  fireEvent.press(getByTestId("add-source-submit"));
  expect(onSubmit).not.toHaveBeenCalled();
});

test("shows the error line when error is set", () => {
  const { getByTestId } = render(<AddSourceForm onSubmit={jest.fn()} error="nope" />);
  expect(getByTestId("add-source-error").props.children).toBe("nope");
});

test("shows the neutral-conduit responsibility warning", () => {
  const { getByText } = render(<AddSourceForm onSubmit={jest.fn()} />);
  expect(getByText(/your responsibility/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/AddSourceForm.test.tsx`
Expected: FAIL — cannot find module `../AddSourceForm`.

- [ ] **Step 3: Write the implementation**

```tsx
// mobile/src/openshelves/AddSourceForm.tsx
// Presentational: collect a feed URL + surface parent-owned error/busy. No store,
// no network, no alert — the screen owns add + the P0-8 warning confirm.
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";

interface Props {
  onSubmit: (url: string) => void;
  busy?: boolean;
  error?: string | null;
}

export function AddSourceForm({ onSubmit, busy, error }: Props) {
  const [url, setUrl] = useState("");
  const submit = () => {
    const trimmed = url.trim();
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <View style={styles.wrap}>
      <TextInput
        testID="add-source-input"
        style={styles.input}
        value={url}
        onChangeText={setUrl}
        placeholder="https://…  (an OPDS catalog URL)"
        placeholderTextColor={colors.textMuted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        editable={!busy}
      />
      <Pressable testID="add-source-submit" style={styles.button} onPress={submit} disabled={busy}>
        <Text style={styles.buttonText}>Add source</Text>
      </Pressable>
      <Text style={styles.warning}>
        Libraries you add are outside Mentible's curation — using them is your responsibility.
      </Text>
      {error ? (
        <Text testID="add-source-error" style={styles.error}>{error}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.text, ...typography.body,
  },
  button: {
    backgroundColor: colors.primary, borderRadius: radius.md,
    paddingVertical: spacing.sm, alignItems: "center",
  },
  buttonText: { color: colors.onPrimary, ...typography.button },
  warning: { color: colors.textMuted, ...typography.caption },
  error: { color: colors.error, ...typography.caption },
});
```

> Implementer: confirm the exact token names in `@/constants/theme` (e.g. `colors.onPrimary`, `colors.error`, `typography.button`/`caption`). If a token is named differently, use the nearest existing one — do not invent new theme tokens. Grep `mobile/src/constants/theme.ts` first.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/AddSourceForm.test.tsx`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/AddSourceForm.tsx mobile/src/openshelves/__tests__/AddSourceForm.test.tsx
git commit -m "feat(open-shelves): AddSourceForm component (url input + warning + error)"
```

---

### Task 3: `SourceRow` component

**Files:**
- Create: `mobile/src/openshelves/SourceRow.tsx`
- Test: `mobile/src/openshelves/__tests__/SourceRow.test.tsx`

**Interfaces:**
- Consumes: `FeedSource` from `./types`.
- Produces: `SourceRow(props: { source: FeedSource; onRefresh: (id: string) => void; onRemove: (id: string) => void; busy?: boolean }): JSX.Element` — renders the source title (or its URL when `title` is null), `entryCount` (e.g. "12 items"), last-refreshed ("Never" when null), a Refresh button (`testID={`refresh-${id}`}`) and a Remove button (`testID={`remove-${id}`}`) wired to the callbacks.

**Notes for the implementer:** presentational only. The confirm-before-remove (P0-8/P0-1) lives in the screen (Task 4), not here — `onRemove` fires immediately; the screen decides whether to confirm.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/SourceRow.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { SourceRow } from "../SourceRow";
import type { FeedSource } from "../types";

const src = (over: Partial<FeedSource> = {}): FeedSource => ({
  id: "s1", url: "https://ex.org/f", title: "My Library", addedAt: "T0",
  lastRefreshedAt: null, isStarter: false, entryCount: 12, ...over,
});

test("renders title, count, and 'Never' when unrefreshed", () => {
  const { getByText } = render(<SourceRow source={src()} onRefresh={jest.fn()} onRemove={jest.fn()} />);
  expect(getByText("My Library")).toBeTruthy();
  expect(getByText(/12 items/)).toBeTruthy();
  expect(getByText(/Never/)).toBeTruthy();
});

test("falls back to url when title is null", () => {
  const { getByText } = render(<SourceRow source={src({ title: null })} onRefresh={jest.fn()} onRemove={jest.fn()} />);
  expect(getByText("https://ex.org/f")).toBeTruthy();
});

test("refresh and remove buttons call callbacks with the id", () => {
  const onRefresh = jest.fn(); const onRemove = jest.fn();
  const { getByTestId } = render(<SourceRow source={src()} onRefresh={onRefresh} onRemove={onRemove} />);
  fireEvent.press(getByTestId("refresh-s1"));
  fireEvent.press(getByTestId("remove-s1"));
  expect(onRefresh).toHaveBeenCalledWith("s1");
  expect(onRemove).toHaveBeenCalledWith("s1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/SourceRow.test.tsx`
Expected: FAIL — cannot find module `../SourceRow`.

- [ ] **Step 3: Write the implementation**

```tsx
// mobile/src/openshelves/SourceRow.tsx
// Presentational row for one subscribed source (spec P0-1). Title/url, entry
// count, last-refreshed, and Refresh/Remove buttons. The screen owns any confirm.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedSource } from "./types";

interface Props {
  source: FeedSource;
  onRefresh: (id: string) => void;
  onRemove: (id: string) => void;
  busy?: boolean;
}

export function SourceRow({ source, onRefresh, onRemove, busy }: Props) {
  const { id, title, url, entryCount, lastRefreshedAt } = source;
  return (
    <View style={styles.row}>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={1}>{title ?? url}</Text>
        <Text style={styles.sub}>
          {entryCount} items · Last refreshed: {lastRefreshedAt ?? "Never"}
        </Text>
      </View>
      <Pressable testID={`refresh-${id}`} style={styles.action} onPress={() => onRefresh(id)} disabled={busy}>
        <Text style={styles.actionText}>Refresh</Text>
      </Pressable>
      <Pressable testID={`remove-${id}`} style={styles.action} onPress={() => onRemove(id)} disabled={busy}>
        <Text style={[styles.actionText, styles.removeText]}>Remove</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, ...typography.body },
  sub: { color: colors.textMuted, ...typography.caption },
  action: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.sm },
  actionText: { color: colors.primary, ...typography.button },
  removeText: { color: colors.error },
});
```

> Implementer: same theme-token caveat as Task 2 — verify token names, don't invent.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/SourceRow.test.tsx`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/SourceRow.tsx mobile/src/openshelves/__tests__/SourceRow.test.tsx
git commit -m "feat(open-shelves): SourceRow component (title/count/refreshed + actions)"
```

---

### Task 4: `shelves` screen — compose hook + components + P0-8 confirm

**Files:**
- Create: `mobile/app/(tabs)/shelves.tsx`
- Test: `mobile/__tests__/app/shelves.test.tsx`

**Interfaces:**
- Consumes: `useOpenShelves` from `@/openshelves/useOpenShelves`; `AddSourceForm`, `SourceRow` from `@/openshelves/…`; `Alert` from `@/lib/alert`; `PageContainer` from `@/components/PageContainer`.
- Produces: `default` export `ShelvesScreen` — the Sources management screen. Adding a source shows the **`@/lib/alert` confirm** carrying the neutral-conduit warning; on confirm it calls the hook's `add(url)`. Renders an empty state when there are no sources, the list of `SourceRow`s otherwise, a "Refresh all" control, and the hook's `error`.

**Notes for the implementer:**
- Wire `AddSourceForm`'s `onSubmit` to a handler that calls `Alert.alert(title, message, [{ text: "Cancel", style: "cancel" }, { text: "Add", onPress: () => hook.add(url) }])`. Because `@/lib/alert` maps to `window.confirm` on web, the confirm actually fires — do not call `hook.add` directly without the confirm (P0-8).
- Remove also confirms via `Alert.alert` before `hook.remove(id)`.
- The screen test mocks `@/openshelves/useOpenShelves` (return a controllable fake) and `@/lib/alert` (assert it was called; invoke the confirm button's `onPress` to drive `add`). Do **not** mount the real hook/store in the screen test.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/shelves.test.tsx
import { render, fireEvent } from "@testing-library/react-native";

const add = jest.fn().mockResolvedValue(true);
const remove = jest.fn();
const refresh = jest.fn();
const refreshAllSources = jest.fn();
let hookState: any;
jest.mock("@/openshelves/useOpenShelves", () => ({ useOpenShelves: () => hookState }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { Alert } from "@/lib/alert";
import ShelvesScreen from "@/../app/(tabs)/shelves";

const src = (id: string) => ({ id, url: `https://ex.org/${id}`, title: id, addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 1 });

beforeEach(() => {
  jest.clearAllMocks();
  hookState = { sources: [], loading: false, busy: false, error: null, add, remove, refresh, refreshAllSources, reload: jest.fn() };
});

test("empty state when no sources", () => {
  const { getByText } = render(<ShelvesScreen />);
  expect(getByText(/no sources yet/i)).toBeTruthy();
});

test("adding a source confirms via Alert before calling add (P0-8)", () => {
  const { getByTestId } = render(<ShelvesScreen />);
  fireEvent.changeText(getByTestId("add-source-input"), "https://ex.org/f");
  fireEvent.press(getByTestId("add-source-submit"));
  // The confirm was raised, and add is NOT called until its button fires.
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(add).not.toHaveBeenCalled();
  // Drive the confirm's "Add" button.
  const buttons = (Alert.alert as jest.Mock).mock.calls[0][2];
  const addBtn = buttons.find((b: any) => b.text === "Add");
  addBtn.onPress();
  expect(add).toHaveBeenCalledWith("https://ex.org/f");
});

test("renders a row per source and surfaces the hook error", () => {
  hookState = { ...hookState, sources: [src("a"), src("b")], error: "boom" };
  const { getByTestId, getByText } = render(<ShelvesScreen />);
  expect(getByTestId("remove-a")).toBeTruthy();
  expect(getByTestId("remove-b")).toBeTruthy();
  expect(getByText("boom")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/app/shelves.test.tsx`
Expected: FAIL — cannot find module `app/(tabs)/shelves`.

- [ ] **Step 3: Write the implementation**

```tsx
// mobile/app/(tabs)/shelves.tsx
// Open Shelves — Sources management (spec P0-1). Add a free book repo by URL,
// list/refresh/remove sources. User-added sources are warned (P0-8, neutral
// conduit) and never blocked. No auth required.
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Alert } from "@/lib/alert";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography, radius } from "@/constants/theme";
import { useOpenShelves } from "@/openshelves/useOpenShelves";
import { AddSourceForm } from "@/openshelves/AddSourceForm";
import { SourceRow } from "@/openshelves/SourceRow";

const WARNING =
  "This library is outside Mentible's curation. You're responsible for the content you add and read. Add it?";

export default function ShelvesScreen() {
  const shelves = useOpenShelves();

  const confirmAdd = (url: string) => {
    Alert.alert("Add this source?", WARNING, [
      { text: "Cancel", style: "cancel" },
      { text: "Add", onPress: () => { void shelves.add(url); } },
    ]);
  };

  const confirmRemove = (id: string) => {
    Alert.alert("Remove source?", "Its catalog entries will be removed from this device.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => { void shelves.remove(id); } },
    ]);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.heading}>Open Shelves</Text>
        <Text style={styles.blurb}>Browse free book catalogs (OPDS). Add a repo by URL.</Text>

        <AddSourceForm onSubmit={confirmAdd} busy={shelves.busy} error={shelves.error} />

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Sources</Text>
          {shelves.sources.length > 0 ? (
            <Pressable testID="refresh-all" onPress={() => void shelves.refreshAllSources()} disabled={shelves.busy}>
              <Text style={styles.refreshAll}>Refresh all</Text>
            </Pressable>
          ) : null}
        </View>

        {shelves.sources.length === 0 ? (
          <Text style={styles.empty}>No sources yet. Add an OPDS catalog URL above.</Text>
        ) : (
          shelves.sources.map((s) => (
            <SourceRow key={s.id} source={s} busy={shelves.busy} onRefresh={shelves.refresh} onRemove={confirmRemove} />
          ))
        )}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg },
  heading: { color: colors.text, ...typography.h1, marginBottom: spacing.xs },
  blurb: { color: colors.textMuted, ...typography.body, marginBottom: spacing.lg },
  listHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: spacing.lg },
  sectionTitle: { color: colors.text, ...typography.h2 },
  refreshAll: { color: colors.primary, ...typography.button },
  empty: { color: colors.textMuted, ...typography.body, marginTop: spacing.md },
});
```

> Implementer: verify theme token names (`typography.h1`/`h2`, `colors.background`) against `mobile/src/constants/theme.ts`; use the nearest existing token if a name differs. The screen import path in the test (`@/../app/(tabs)/shelves`) must resolve — if the alias form fails, import via the relative path the repo's other `__tests__/app/*` tests use (check `__tests__/app/book-shared.test.tsx`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest __tests__/app/shelves.test.tsx`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/(tabs)/shelves.tsx" mobile/__tests__/app/shelves.test.tsx
git commit -m "feat(open-shelves): Sources screen (add w/ P0-8 confirm, list, refresh, remove)"
```

---

### Task 5: Navigation tile + Help topic (make it a shipped feature)

**Files:**
- Modify: `mobile/src/constants/labels.ts` (add `shelves` to `NAV`)
- Modify: `mobile/src/components/TopNavBar.tsx` (add the `shelves` tile + place it in `ORDER`)
- Modify: `mobile/app/(tabs)/_layout.tsx` (add `<Tabs.Screen name="shelves" />`)
- Modify: `mobile/src/help-content/features.ts` (add the `open-shelves` FEATURES key)
- Modify: `mobile/src/help-content/topics.ts` (add a topic with `featureKey: "open-shelves"`)

**Interfaces:**
- Consumes/produces: nav registration for the `shelves` route + a Help topic satisfying the coverage gate.

**Notes for the implementer:**
- `NAV`: add `shelves: "Shelves"`.
- `TopNavBar` `TABS`: add `shelves: { label: NAV.shelves, active: "albums", inactive: "albums-outline" }`; add `"shelves"` to the `ORDER` array (place it right after `"library"`).
- `_layout.tsx`: add `<Tabs.Screen name="shelves" />` (order there doesn't drive visual order — TopNavBar's `ORDER` does).
- Help topic: match the existing object shape in `topics.ts` exactly (read a neighbor topic for the required fields — likely `id`, `title`, `featureKey`, `body`, and possibly `keywords`/`steps`). Use `id: "open-shelves"`, `featureKey: "open-shelves"`, a title like "Add & manage free book repos (Open Shelves)", and body copy covering: add an OPDS catalog URL; starter libraries exist; user-added libraries are your responsibility (P0-8); refresh/remove; authenticated repos aren't supported yet (P0-9).

- [ ] **Step 1: Add the NAV label, nav tile, and route**

Edit `mobile/src/constants/labels.ts` — add to the `NAV` object:
```typescript
  shelves: "Shelves",
```
Edit `mobile/src/components/TopNavBar.tsx` — add to `TABS`:
```typescript
  shelves: { label: NAV.shelves, active: "albums", inactive: "albums-outline" },
```
and change `ORDER` to include it after library:
```typescript
const ORDER = ["library", "shelves", "books", "settings", "help", "about"];
```
Edit `mobile/app/(tabs)/_layout.tsx` — add inside `<Tabs>`:
```tsx
      <Tabs.Screen name="shelves" />
```

- [ ] **Step 2: Add the Help feature + topic**

Edit `mobile/src/help-content/features.ts` — add to the `FEATURES` array:
```typescript
  { key: "open-shelves", label: "Open Shelves (free book repos)" },
```
Edit `mobile/src/help-content/topics.ts` — add a new topic object (match the neighbor shape) with `id: "open-shelves"`, `featureKey: "open-shelves"`, a clear title, and body copy per the notes above.

- [ ] **Step 3: Run the Help coverage gate + the nav-affected tests**

Run: `cd mobile && npx jest __tests__/help/coverage.test.ts`
Expected: PASS — the `open-shelves` feature now has a covering topic (the gate would fail if the topic were missing/mismatched).

Run: `cd mobile && npx jest src/openshelves __tests__/app/shelves.test.tsx && npx tsc --noEmit -p tsconfig.json`
Expected: all Open Shelves suites pass; no new tsc errors.

- [ ] **Step 4: Commit**

```bash
git add mobile/src/constants/labels.ts mobile/src/components/TopNavBar.tsx "mobile/app/(tabs)/_layout.tsx" mobile/src/help-content/features.ts mobile/src/help-content/topics.ts
git commit -m "feat(open-shelves): add Shelves nav tile + Help topic (coverage gate)"
```

---

## What this plan leaves to later plans

- **Browse + provenance** (P0-7) — tap a source → its catalog (entry list/detail) from `getEntries`; web HTML rendering reuses `sanitizeFragment`.
- **Starter list** (P0-5) — seed the three owner-curated `isStarter` sources via remote config; D3a live-feed verification.
- **Downloads** (P0-6/P0-10) — re-validate `link.href` (plan-1 SSRF note) before fetching.
- **Language filter F-1** — over the stored `FeedEntry` fields.
- **Concurrency hardening** — a write queue on the sources blob (plan-2 final-review note) if concurrent adds become reachable from this UI (a fast double-tap "Add" is now possible — the confirm dialog mitigates but doesn't serialize).

## Self-Review

**Spec coverage (this slice):** P0-1 add/list/remove + entry count + last-refreshed → Tasks 1–4; P0-4 refresh (per-source + all) surfaced → Tasks 1/3/4; P0-8 add-time warning (confirm, not block) → Task 4 `confirmAdd`; P0-9 no-auth message mapping → Task 1 `toMessage` + rendered in Task 4; Help/Definition-of-Done → Task 5. Browse/starter/downloads/filters explicitly deferred.

**Placeholder scan:** none — every step has real code/commands. Two implementer verifications are flagged (theme-token names; the screen test's import path) with concrete fallbacks, not left vague.

**Type consistency:** `FeedSource` (with plan-2's `entryCount`) flows unchanged through the hook, `SourceRow`, and the screen; `useOpenShelves`'s returned shape ({sources, loading, busy, error, reload, add, remove, refresh, refreshAllSources}) is consumed identically in the screen and mocked identically in the screen test; `AddSourceForm`/`SourceRow` prop signatures match their call sites in Task 4.
