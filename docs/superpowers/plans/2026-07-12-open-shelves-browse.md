# Open Shelves — Browse + Provenance (ADR-028, plan 4 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader open a source and browse its catalog (spec P0-1 "view details") with provenance on every entry (spec P0-7): a `useSourceCatalog` hook, an `EntryRow` list item, a catalog screen (`app/shelves/[sourceId].tsx`), and an entry-detail screen showing source repo + rights ("Not stated by source" when absent, never invented) + a "View at source" link. Also folds in the plan-3 deferred per-row refresh-error placement.

**Architecture:** Two drill-down routes under `app/shelves/` registered in the root `app/_layout.tsx` Stack (mirroring `app/book/*`). `useSourceCatalog(sourceId)` reads the source record (`feedSourcesStore.getSource`) + its entries (`feedEntriesStore.getEntries`) and exposes a per-source `refresh`. `EntryRow`/`EntryDetail` are presentational. **No HTML rendering:** every `FeedEntry` string was normalized to plaintext by the plan-1 parser, so browse renders plain `Text`/`Image` — there is no HTML sink and `sanitizeFragment` is not needed here. `coverUrl`/`canonicalUrl` were scheme-allowlisted (http/https only) in plan 1, so `<Image source={{uri}}>` and `Linking.openURL(...)` are safe. Downloads (P0-6/P0-10) are a later plan — browse only surfaces metadata + a "View at source" link.

**Tech Stack:** React Native + expo-router (`useLocalSearchParams`/`useRouter`), `Linking` (react-native), `@testing-library/react-native`, jest-expo. Branch: `feat/open-shelves` (localhost-only; never deployed).

## Global Constraints

- **Location:** hook + components in `mobile/src/openshelves/`; routes at `mobile/app/shelves/[sourceId].tsx` and `mobile/app/shelves/[sourceId]/[entryId].tsx`; register both in `mobile/app/_layout.tsx` Stack. Tests: components/hook in `mobile/src/openshelves/__tests__/` (`*.test.tsx`), screens in `mobile/__tests__/app/`. Commands run from `mobile/`.
- **No HTML rendering / no sanitizeFragment:** entry fields are plaintext (plan-1). Render with `Text`. Do **not** introduce `dangerouslySetInnerHTML`/HTML injection or import `sanitize.ts`.
- **URLs are pre-hardened:** `coverUrl`/`canonicalUrl`/`link.href` are http/https-only (plan-1 `sanitizeUrl`). Use `coverUrl` directly in `<Image>`; open `canonicalUrl` via `Linking.openURL`. Do **not** re-open a `link.href` for download here (downloads are a later plan).
- **Provenance (spec P0-7):** entry detail shows the **source repo** (the `FeedSource.title` or its url) and the **rights** string exactly as provided; when `rightsText` is null render **"Not stated by source"** — never fabricate a license. Always show the canonical source link when present.
- **Presentational components:** `EntryRow`/`EntryDetail` take props only — no store, no navigation, no `Linking`. The screens own data-loading (hook) and actions (navigate, open URL).
- **No auth gating; no live network in tests** (mock the stores / `Linking`). RNTL `findBy`/`waitFor` obey `asyncUtilTimeout` (~1000ms) — resolve mocks immediately.
- **Scope:** browsing + provenance only. Downloads, filters, starter list, and search are later plans.

---

### Task 1: `useSourceCatalog` hook

**Files:**
- Create: `mobile/src/openshelves/useSourceCatalog.ts`
- Test: `mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx`

**Interfaces:**
- Consumes: `getSource` from `./feedSourcesStore`; `getEntries` from `./feedEntriesStore`; `refreshSource` from `./feedStore`; `FeedSource`, `FeedEntry` from `./types`.
- Produces:
  - `useSourceCatalog(sourceId: string): { source: FeedSource | null; entries: FeedEntry[]; loading: boolean; busy: boolean; error: string | null; reload(): Promise<void>; refresh(): Promise<void> }`
  - `reload` loads the source record + its entries; `refresh` calls `refreshSource(sourceId)` then reloads. `refresh` maps errors to `error` (reuse the same `toMessage` shape as `useOpenShelves` — authRequired → "Authenticated repos aren't supported yet.", else `.message`).

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useSourceCatalog } from "../useSourceCatalog";

jest.mock("../feedSourcesStore", () => ({ getSource: jest.fn() }));
jest.mock("../feedEntriesStore", () => ({ getEntries: jest.fn() }));
jest.mock("../feedStore", () => ({ refreshSource: jest.fn() }));
import { getSource } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { refreshSource } from "../feedStore";

const source = { id: "s1", url: "https://ex.org/f", title: "Lib", addedAt: "T0", lastRefreshedAt: null, isStarter: false, entryCount: 2 };
const entry = (id: string) => ({ id, title: id, authors: [], summary: "", coverUrl: null, language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null });

beforeEach(() => jest.clearAllMocks());

test("loads source + entries on mount", async () => {
  (getSource as jest.Mock).mockResolvedValue(source);
  (getEntries as jest.Mock).mockResolvedValue([entry("a"), entry("b")]);
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.source?.title).toBe("Lib");
  expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
});

test("refresh calls refreshSource then reloads", async () => {
  (getSource as jest.Mock).mockResolvedValue(source);
  (getEntries as jest.Mock).mockResolvedValueOnce([entry("a")]).mockResolvedValueOnce([entry("a"), entry("c")]);
  (refreshSource as jest.Mock).mockResolvedValue({ added: 1, updated: 0, removed: 0 });
  const { result } = renderHook(() => useSourceCatalog("s1"));
  await waitFor(() => expect(result.current.entries.length).toBe(1));
  await act(async () => { await result.current.refresh(); });
  expect(refreshSource).toHaveBeenCalledWith("s1");
  expect(result.current.entries.map((e) => e.id)).toEqual(["a", "c"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/useSourceCatalog.test.tsx`
Expected: FAIL — cannot find module `../useSourceCatalog`.

- [ ] **Step 3: Write the implementation**

```tsx
// mobile/src/openshelves/useSourceCatalog.ts
// Loads one source's record + its catalog entries for the browse screen, with a
// per-source refresh. Read-only over the plan-2 stores; components stay dumb.
import { useCallback, useEffect, useState } from "react";
import type { FeedEntry, FeedSource } from "./types";
import { FeedSourceError } from "./errors";
import { getSource } from "./feedSourcesStore";
import { getEntries } from "./feedEntriesStore";
import { refreshSource } from "./feedStore";

function toMessage(err: unknown): string {
  if (err instanceof FeedSourceError && err.authRequired) {
    return "Authenticated repos aren't supported yet.";
  }
  return (err as Error)?.message ?? "Something went wrong.";
}

export function useSourceCatalog(sourceId: string) {
  const [source, setSource] = useState<FeedSource | null>(null);
  const [entries, setEntries] = useState<FeedEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [s, e] = await Promise.all([getSource(sourceId), getEntries(sourceId)]);
    setSource(s);
    setEntries(e);
    setLoading(false);
  }, [sourceId]);

  useEffect(() => { void reload(); }, [reload]);

  const refresh = useCallback(async () => {
    setBusy(true);
    setError(null);
    try { await refreshSource(sourceId); await reload(); }
    catch (err) { setError(toMessage(err)); }
    finally { setBusy(false); }
  }, [sourceId, reload]);

  return { source, entries, loading, busy, error, reload, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/useSourceCatalog.test.tsx`
Expected: PASS — 2 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/useSourceCatalog.ts mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx
git commit -m "feat(open-shelves): useSourceCatalog hook (source + entries + refresh)"
```

---

### Task 2: `EntryRow` component

**Files:**
- Create: `mobile/src/openshelves/EntryRow.tsx`
- Test: `mobile/src/openshelves/__tests__/EntryRow.test.tsx`

**Interfaces:**
- Consumes: `FeedEntry` from `./types`.
- Produces: `EntryRow(props: { entry: FeedEntry; onPress: (entryId: string) => void }): JSX.Element` — a pressable row (`testID={`entry-${id}`}`) showing the cover (`<Image>` when `coverUrl`, else a placeholder box), the title, the first author (or "Unknown author"), and a media-type badge (book/audio/video/other). Tapping calls `onPress(entry.id)`.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/EntryRow.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { EntryRow } from "../EntryRow";
import type { FeedEntry } from "../types";

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "e1", title: "Moby Dick", authors: ["Herman Melville"], summary: "", coverUrl: null,
  language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null, ...over,
});

test("renders title, author, and media badge", () => {
  const { getByText } = render(<EntryRow entry={entry()} onPress={jest.fn()} />);
  expect(getByText("Moby Dick")).toBeTruthy();
  expect(getByText("Herman Melville")).toBeTruthy();
  expect(getByText(/book/i)).toBeTruthy();
});

test("falls back to 'Unknown author' with no authors", () => {
  const { getByText } = render(<EntryRow entry={entry({ authors: [] })} onPress={jest.fn()} />);
  expect(getByText(/unknown author/i)).toBeTruthy();
});

test("press calls onPress with the entry id", () => {
  const onPress = jest.fn();
  const { getByTestId } = render(<EntryRow entry={entry()} onPress={onPress} />);
  fireEvent.press(getByTestId("entry-e1"));
  expect(onPress).toHaveBeenCalledWith("e1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/EntryRow.test.tsx`
Expected: FAIL — cannot find module `../EntryRow`.

- [ ] **Step 3: Write the implementation**

```tsx
// mobile/src/openshelves/EntryRow.tsx
// Presentational catalog list item. Plaintext fields only (plan-1 normalized) +
// a scheme-allowlisted cover URL — no HTML, no navigation, no store.
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedEntry } from "./types";

interface Props {
  entry: FeedEntry;
  onPress: (entryId: string) => void;
}

export function EntryRow({ entry, onPress }: Props) {
  const author = entry.authors[0] ?? "Unknown author";
  return (
    <Pressable testID={`entry-${entry.id}`} style={styles.row} onPress={() => onPress(entry.id)}>
      {entry.coverUrl ? (
        <Image source={{ uri: entry.coverUrl }} style={styles.cover} resizeMode="cover" />
      ) : (
        <View style={[styles.cover, styles.coverPlaceholder]} />
      )}
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>{entry.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{author}</Text>
        <Text style={styles.badge}>{entry.mediaType}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.md, paddingVertical: spacing.sm, alignItems: "center" },
  cover: { width: 44, height: 60, borderRadius: radius.sm, backgroundColor: colors.border },
  coverPlaceholder: { backgroundColor: colors.borderLight },
  meta: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  author: { color: colors.textMuted, fontSize: typography.sizeSm },
  badge: { color: colors.textMuted, fontSize: typography.sizeXs, marginTop: 2 },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/EntryRow.test.tsx`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/EntryRow.tsx mobile/src/openshelves/__tests__/EntryRow.test.tsx
git commit -m "feat(open-shelves): EntryRow component (cover + title + author + media badge)"
```

---

### Task 3: Catalog screen + make sources open it

**Files:**
- Create: `mobile/app/shelves/[sourceId].tsx`
- Modify: `mobile/src/openshelves/SourceRow.tsx` (make the row title pressable → `onOpen(id)`)
- Modify: `mobile/app/(tabs)/shelves.tsx` (pass `onOpen` that navigates; fold in the plan-3 deferred per-row refresh-error note — keep it simple: leave the shared error slot but this task doesn't regress it)
- Modify: `mobile/app/_layout.tsx` (register `<Stack.Screen name="shelves/[sourceId]" />`)
- Test: `mobile/__tests__/app/shelves-catalog.test.tsx`

**Interfaces:**
- Consumes: `useSourceCatalog` from `@/openshelves/useSourceCatalog`; `EntryRow` from `@/openshelves/EntryRow`; `useLocalSearchParams`, `useRouter` from `expo-router`; `PageContainer`.
- Produces: the catalog screen — header (source title, entry count, a Refresh button), a list of `EntryRow`s, empty state, and error. Tapping an entry navigates to `/shelves/{sourceId}/{entryId}`. `SourceRow` gains an `onOpen?: (id: string) => void` prop wired from the Shelves screen to `router.push('/shelves/' + id)`.

**Notes for the implementer:**
- `SourceRow`: add `onOpen?: (id) => void`; wrap the title/meta area in a `Pressable testID={`open-${id}`}` calling `onOpen?.(id)` (keep Refresh/Remove buttons as-is). Update the SourceRow test to cover `open-<id>` press.
- The Shelves screen (`app/(tabs)/shelves.tsx`) imports `useRouter` and passes `onOpen={(id) => router.push(\`/shelves/${id}\`)}` to each `SourceRow`. Its existing tests mock the hook; add `useRouter` to the mock set (`jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }))`) or extend the existing mock — check whether the file already mocks expo-router.
- The catalog screen reads `const { sourceId } = useLocalSearchParams<{ sourceId: string }>()`.
- Register the route: add `<Stack.Screen name="shelves/[sourceId]" options={{ headerShown: false }} />` in `app/_layout.tsx`, mirroring an existing `book/...` Stack.Screen entry (match its options shape).

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/__tests__/app/shelves-catalog.test.tsx
import { render, fireEvent } from "@testing-library/react-native";

const push = jest.fn();
let catalog: any;
jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ sourceId: "s1" }),
  useRouter: () => ({ push }),
}));
jest.mock("@/openshelves/useSourceCatalog", () => ({ useSourceCatalog: () => catalog }));
import CatalogScreen from "@/../app/shelves/[sourceId]";

const entry = (id: string) => ({ id, title: id, authors: ["A"], summary: "", coverUrl: null, language: null, categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null });

beforeEach(() => {
  jest.clearAllMocks();
  catalog = { source: { id: "s1", title: "Lib", url: "https://ex.org/f", entryCount: 2, isStarter: false, addedAt: "T0", lastRefreshedAt: null }, entries: [entry("a"), entry("b")], loading: false, busy: false, error: null, reload: jest.fn(), refresh: jest.fn() };
});

test("lists entries and navigates on tap", () => {
  const { getByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("entry-a"));
  expect(push).toHaveBeenCalledWith("/shelves/s1/a");
});

test("shows the source title and empty state when no entries", () => {
  catalog = { ...catalog, entries: [] };
  const { getByText } = render(<CatalogScreen />);
  expect(getByText("Lib")).toBeTruthy();
  expect(getByText(/no items/i)).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest __tests__/app/shelves-catalog.test.tsx`
Expected: FAIL — cannot find module `app/shelves/[sourceId]`.

- [ ] **Step 3: Write the implementations**

Add `onOpen` to `mobile/src/openshelves/SourceRow.tsx` — change the `meta` `View` into a pressable:
```tsx
// in Props: add `onOpen?: (id: string) => void;`
// replace the <View style={styles.meta}> ... </View> block with:
      <Pressable testID={`open-${id}`} style={styles.meta} onPress={() => onOpen?.(id)}>
        <Text style={styles.title} numberOfLines={1}>{title ?? url}</Text>
        <Text style={styles.sub}>
          {entryCount} items · Last refreshed: {lastRefreshedAt ?? "Never"}
        </Text>
      </Pressable>
```
(destructure `onOpen` from props alongside the others.)

Create `mobile/app/shelves/[sourceId].tsx`:
```tsx
// Catalog for one source (spec P0-1 "view details"). Plaintext entries; tapping
// an entry opens its detail. No downloads here (later plan).
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { EntryRow } from "@/openshelves/EntryRow";

export default function CatalogScreen() {
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const router = useRouter();
  const cat = useSourceCatalog(sourceId);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>{cat.source?.title ?? "Catalog"}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{cat.entries.length} items</Text>
          <Pressable testID="catalog-refresh" onPress={() => void cat.refresh()} disabled={cat.busy}>
            <Text style={styles.refresh}>Refresh</Text>
          </Pressable>
        </View>
        {cat.error ? <Text style={styles.error}>{cat.error}</Text> : null}
        {cat.loading && cat.entries.length === 0 ? null : cat.entries.length === 0 ? (
          <Text style={styles.empty}>No items in this catalog.</Text>
        ) : (
          cat.entries.map((e) => (
            <EntryRow key={e.id} entry={e} onPress={(entryId) => router.push(`/shelves/${sourceId}/${entryId}`)} />
          ))
        )}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: spacing.md },
  sub: { color: colors.textMuted, fontSize: typography.sizeMd },
  refresh: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
```

Wire `onOpen` in `mobile/app/(tabs)/shelves.tsx`: import `useRouter` from `expo-router`, get `const router = useRouter();`, and pass `onOpen={(id) => router.push(\`/shelves/${id}\`)}` to each `<SourceRow>`.

Register the route in `mobile/app/_layout.tsx` — add inside the `<Stack>` (match an existing `book/...` entry's options):
```tsx
        <Stack.Screen name="shelves/[sourceId]" options={{ headerShown: false }} />
```

Update `mobile/src/openshelves/__tests__/SourceRow.test.tsx` — add a test that pressing `open-s1` calls `onOpen("s1")`.
Update `mobile/__tests__/app/shelves.test.tsx` — ensure `expo-router` is mocked with a `useRouter` returning `{ push: jest.fn() }` (add to the existing mock block).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mobile && npx jest __tests__/app/shelves-catalog.test.tsx __tests__/app/shelves.test.tsx src/openshelves/__tests__/SourceRow.test.tsx`
Expected: PASS — the catalog screen navigates, SourceRow open works, and the existing shelves screen still passes with the router mock.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/shelves/[sourceId].tsx" mobile/src/openshelves/SourceRow.tsx "mobile/app/(tabs)/shelves.tsx" mobile/app/_layout.tsx mobile/__tests__/app/shelves-catalog.test.tsx mobile/src/openshelves/__tests__/SourceRow.test.tsx mobile/__tests__/app/shelves.test.tsx
git commit -m "feat(open-shelves): catalog screen + open-source navigation"
```

---

### Task 4: Entry detail screen + provenance

**Files:**
- Create: `mobile/src/openshelves/EntryDetail.tsx`
- Create: `mobile/app/shelves/[sourceId]/[entryId].tsx`
- Modify: `mobile/app/_layout.tsx` (register `shelves/[sourceId]/[entryId]`)
- Test: `mobile/src/openshelves/__tests__/EntryDetail.test.tsx`

**Interfaces:**
- Consumes: `FeedEntry`, `FeedSource` from `./types`.
- Produces:
  - `EntryDetail(props: { entry: FeedEntry; sourceTitle: string; onViewAtSource: (url: string) => void }): JSX.Element` — cover, title, authors, media type, summary, and a **Provenance** block: source repo (`sourceTitle`), rights (`entry.rightsText` or **"Not stated by source"**), and a "View at source" button (`testID="view-at-source"`, shown only when `entry.canonicalUrl` is non-null) calling `onViewAtSource(entry.canonicalUrl)`.
  - The route screen `app/shelves/[sourceId]/[entryId].tsx` loads the entry via `useSourceCatalog(sourceId)` (find the entry by id), passes the source title, and wires `onViewAtSource` to `Linking.openURL`.

- [ ] **Step 1: Write the failing test (the presentational component)**

```tsx
// mobile/src/openshelves/__tests__/EntryDetail.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { EntryDetail } from "../EntryDetail";
import type { FeedEntry } from "../types";

const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "e1", title: "Moby Dick", authors: ["Herman Melville"], summary: "A whale.", coverUrl: null,
  language: null, categories: [], mediaType: "book", rightsText: "Public Domain", mature: null,
  links: [], canonicalUrl: "https://ex.org/moby", ...over,
});

test("shows provenance: source, rights, and view-at-source", () => {
  const onView = jest.fn();
  const { getByText, getByTestId } = render(<EntryDetail entry={entry()} sourceTitle="My Library" onViewAtSource={onView} />);
  expect(getByText("Moby Dick")).toBeTruthy();
  expect(getByText(/My Library/)).toBeTruthy();
  expect(getByText(/Public Domain/)).toBeTruthy();
  fireEvent.press(getByTestId("view-at-source"));
  expect(onView).toHaveBeenCalledWith("https://ex.org/moby");
});

test("renders 'Not stated by source' when rights are absent, never invents a license", () => {
  const { getByText } = render(<EntryDetail entry={entry({ rightsText: null })} sourceTitle="Lib" onViewAtSource={jest.fn()} />);
  expect(getByText(/not stated by source/i)).toBeTruthy();
});

test("hides view-at-source when there is no canonical url", () => {
  const { queryByTestId } = render(<EntryDetail entry={entry({ canonicalUrl: null })} sourceTitle="Lib" onViewAtSource={jest.fn()} />);
  expect(queryByTestId("view-at-source")).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/EntryDetail.test.tsx`
Expected: FAIL — cannot find module `../EntryDetail`.

- [ ] **Step 3: Write the implementations**

```tsx
// mobile/src/openshelves/EntryDetail.tsx
// Presentational entry detail with provenance (spec P0-7). Plaintext fields; the
// screen owns loading + opening the source link. Rights are surfaced verbatim and
// "Not stated by source" when absent — never fabricated.
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import type { FeedEntry } from "./types";

interface Props {
  entry: FeedEntry;
  sourceTitle: string;
  onViewAtSource: (url: string) => void;
}

export function EntryDetail({ entry, sourceTitle, onViewAtSource }: Props) {
  return (
    <View style={styles.wrap}>
      {entry.coverUrl ? (
        <Image source={{ uri: entry.coverUrl }} style={styles.cover} resizeMode="contain" />
      ) : null}
      <Text style={styles.title}>{entry.title}</Text>
      {entry.authors.length > 0 ? <Text style={styles.author}>{entry.authors.join(", ")}</Text> : null}
      <Text style={styles.badge}>{entry.mediaType}</Text>
      {entry.summary ? <Text style={styles.summary}>{entry.summary}</Text> : null}

      <View style={styles.provenance}>
        <Text style={styles.provTitle}>Provenance</Text>
        <Text style={styles.provLine}>Source: {sourceTitle}</Text>
        <Text style={styles.provLine}>Rights: {entry.rightsText ?? "Not stated by source"}</Text>
        {entry.canonicalUrl ? (
          <Pressable testID="view-at-source" style={styles.button} onPress={() => onViewAtSource(entry.canonicalUrl as string)}>
            <Text style={styles.buttonText}>View at source</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  cover: { width: "100%", height: 220, borderRadius: radius.md, backgroundColor: colors.border },
  title: { color: colors.text, fontSize: typography.sizeXxl, fontWeight: "700" },
  author: { color: colors.textMuted, fontSize: typography.sizeMd },
  badge: { color: colors.textMuted, fontSize: typography.sizeXs },
  summary: { color: colors.text, fontSize: typography.sizeMd, marginTop: spacing.sm },
  provenance: { marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, gap: spacing.xs },
  provTitle: { color: colors.text, fontSize: typography.sizeMd, fontWeight: "600" },
  provLine: { color: colors.textMuted, fontSize: typography.sizeSm },
  button: { marginTop: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: spacing.sm, alignItems: "center" },
  buttonText: { color: colors.primaryText, fontSize: typography.sizeMd, fontWeight: "600" },
});
```

Create the route `mobile/app/shelves/[sourceId]/[entryId].tsx`:
```tsx
// Entry detail route: loads the entry from the source catalog + opens its source
// link via Linking (canonicalUrl is scheme-allowlisted in plan 1, so this is safe).
import { Linking, ScrollView, StyleSheet, Text } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { EntryDetail } from "@/openshelves/EntryDetail";

export default function EntryDetailScreen() {
  const { sourceId, entryId } = useLocalSearchParams<{ sourceId: string; entryId: string }>();
  const cat = useSourceCatalog(sourceId);
  const entry = cat.entries.find((e) => e.id === entryId) ?? null;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        {entry ? (
          <EntryDetail
            entry={entry}
            sourceTitle={cat.source?.title ?? cat.source?.url ?? "Unknown source"}
            onViewAtSource={(url) => { void Linking.openURL(url); }}
          />
        ) : (
          <Text style={styles.missing}>{cat.loading ? "Loading…" : "Entry not found."}</Text>
        )}
      </PageContainer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.background },
  content: { paddingVertical: spacing.lg },
  missing: { color: colors.textMuted, marginTop: spacing.lg },
});
```

Register the route in `mobile/app/_layout.tsx` — add:
```tsx
        <Stack.Screen name="shelves/[sourceId]/[entryId]" options={{ headerShown: false }} />
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/EntryDetail.test.tsx`
Expected: PASS — 3 passed.

- [ ] **Step 5: Whole-suite check + typecheck**

Run: `cd mobile && npx jest src/openshelves __tests__/app __tests__/help && npx tsc --noEmit -p tsconfig.json`
Expected: all Open Shelves + app + help suites pass; no new tsc errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/EntryDetail.tsx "mobile/app/shelves/[sourceId]/[entryId].tsx" mobile/app/_layout.tsx mobile/src/openshelves/__tests__/EntryDetail.test.tsx
git commit -m "feat(open-shelves): entry detail screen + provenance (rights + view at source)"
```

---

## What this plan leaves to later plans

- **Downloads + offline** (P0-6/P0-10) — a Download action on EPUB/PDF/audio `links` (re-validate `href`), device-local storage, a Downloads view. Browse currently only offers "View at source".
- **Starter list** (P0-5) — seed the three `isStarter` sources; D3a live verification.
- **Language filter F-1** + the rest of §6b.
- **Per-source-scoped refresh-error placement** — the plan-3 shared-error-slot note; the catalog screen already scopes its own `error` to the catalog view, so the remaining item is only the Shelves-tab list.

## Self-Review

**Spec coverage (this slice):** P0-1 "view details" (open a source → its catalog) → Tasks 1–3; P0-7 provenance (source + rights, "Not stated by source" when absent, canonical link) → Task 4 `EntryDetail`; plaintext-only rendering / no HTML sink (§7) → Global Constraints + all components. Downloads/starter/filters explicitly deferred.

**Placeholder scan:** none — every step carries real code/commands.

**Type consistency:** `useSourceCatalog`'s returned shape is consumed identically in the catalog + detail screens and mocked identically in their tests; `EntryRow`/`EntryDetail` prop signatures match their screen call sites; `SourceRow`'s new `onOpen?` is optional so its existing call sites (plan-3 shelves screen) keep compiling; `FeedEntry`/`FeedSource` flow unchanged from plan-1 types.
