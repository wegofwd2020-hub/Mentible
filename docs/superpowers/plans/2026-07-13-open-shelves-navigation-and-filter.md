# Open Shelves — Navigation Drill-in + Preference Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OPDS *navigation* catalogs (e.g. Project Gutenberg) browsable+downloadable by following `subsection` links, and add a pure client-side language+maturity filter over catalog entries (ADR-028 §6b).

**Architecture:** Component A (drill-in): the parser captures the navigation link onto `FeedEntry.navigationUrl`; a `useFeedBrowser` hook keeps a browse stack and fetches a sub-feed on demand via the existing `fetchFeed`/`feedTransport` path (so it inherits the XXE/caps/scheme hardening and the web CORS proxy); the catalog screen renders the current frame. Component B (filter): a pure `filterEntries(entries, prefs)`, a device-local persisted prefs store defaulting language to the device locale, and an inline filter bar on the catalog. Build A then B.

**Tech Stack:** React Native + Expo · TypeScript · `@react-native-async-storage/async-storage` · jest-expo + `@testing-library/react-native`. Branch: `feat/open-shelves` (localhost-only). All commands run from `mobile/`.

Spec: `docs/superpowers/specs/2026-07-13-open-shelves-navigation-and-filter-design.md`

## Global Constraints

- **A navigation entry never persists to the store** (spec N2). Only the top-level source catalog is stored (via the existing plan-2 stores). Drilled-in sub-feed entries live only in the browse stack.
- **Drill-in reuses `fetchFeed` + `parseOpds12`** (spec N3) — do NOT write a second fetcher or parser. `fetchFeed(url, fetchImpl?)` returns the feed text; `parseOpds12(xml)` returns `{ feedTitle, entries }`. Relative navigation hrefs resolve with `resolveUrl(baseUrl, href)` from `./downloadTarget` (already exists).
- **The filter is pure and total** (spec F2): `filterEntries(entries, prefs)` never throws. **Unknown language or unknown maturity ⇒ keep the entry** (never hide a book because metadata is missing).
- **Language match** is on the lowercase **primary subtag** (`en-US` → `en`); `prefs.language === "all"` disables the language filter.
- **Maturity**: hide only when `entry.mature === true && prefs.hideMature`. `null`/`false` are kept.
- **Prefs are device-local, declared, persisted** (spec F3): AsyncStorage key `sbq_open_shelves_prefs`; defaults `{ language: deviceLocale(), hideMature: true }`. No behavioral collection — prefs come only from the filter bar, never inferred from browsing.
- **No new dependency** (spec F4): device locale via `navigator.language` (web) / `Intl.DateTimeFormat().resolvedOptions().locale` (native), fallback `"en"`. `expo-localization` is NOT installed — do not add it.
- **`FeedEntry.navigationUrl` is additive** — `reconcileEntries` passes entries through unchanged; old stored entries lacking it read as `null`.

---

### Task 1: Parser captures the navigation link

**Files:**
- Modify: `mobile/src/openshelves/types.ts` (add `navigationUrl` to `FeedEntry`)
- Modify: `mobile/src/openshelves/opds12.ts` (`parseLinks` + `toEntry`)
- Test: `mobile/src/openshelves/__tests__/opds12.test.ts` (extend)

**Interfaces:**
- Produces: `FeedEntry.navigationUrl: string | null` — the entry's `subsection`/opds-catalog link href (relative allowed; resolved at drill time), else `null`. Set for **navigation** entries; `null` for leaf (downloadable) entries.

- [ ] **Step 1: Write the failing test** — add to `opds12.test.ts`:

```typescript
test("captures a subsection navigation link as navigationUrl", () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>nav1</id><title>Whale books</title>
      <link rel="subsection" type="application/atom+xml;profile=opds-catalog" href="/ebooks/2701.opds"/>
    </entry></feed>`;
  const { entries } = parseOpds12(xml);
  expect(entries[0].navigationUrl).toBe("/ebooks/2701.opds");
  expect(entries[0].links).toEqual([]);
});

test("classifies an opds-catalog link with no rel as navigation", () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>nav2</id><title>Shelf</title>
      <link type="application/atom+xml;profile=opds-catalog" href="/sub.opds"/>
    </entry></feed>`;
  expect(parseOpds12(xml).entries[0].navigationUrl).toBe("/sub.opds");
});

test("a downloadable entry has navigationUrl null and keeps its acquisition link", () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><id>book1</id><title>Moby Dick</title>
      <link rel="http://opds-spec.org/acquisition" type="application/epub+zip" href="/a.epub"/>
    </entry></feed>`;
  const e = parseOpds12(xml).entries[0];
  expect(e.navigationUrl).toBeNull();
  expect(e.links.map((l) => l.mimeType)).toContain("application/epub+zip");
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest src/openshelves/__tests__/opds12.test.ts` → FAIL (`navigationUrl` undefined / not on type).

- [ ] **Step 3: Implement**

In `types.ts`, add the field to `FeedEntry` (after `canonicalUrl`):

```typescript
  canonicalUrl: string | null;
  navigationUrl: string | null; // subsection/opds-catalog link → drill-in (spec N1)
```

In `opds12.ts`, change `parseLinks` to also return a navigation href. Replace the function's signature/body return with:

```typescript
function parseLinks(entry: any): {
  links: AcquisitionLink[]; cover: string | null; canonical: string | null; navigation: string | null;
} {
  const links: AcquisitionLink[] = [];
  let cover: string | null = null;
  let canonical: string | null = null;
  let navigation: string | null = null;
  for (const l of asArray<any>(entry.link)) {
    const rel = toPlainText(String(l["@_rel"] ?? ""));
    const type = toPlainText(String(l["@_type"] ?? ""));
    if (!l["@_href"]) continue;
    if (/image|thumbnail/i.test(rel)) {
      if (!cover) cover = sanitizeUrl(l["@_href"]);
      continue;
    }
    const isAcquisition = /acquisition|open-access/i.test(rel) || /epub|pdf|audio|video|mobi/i.test(type);
    if (isAcquisition) {
      const href = sanitizeUrl(l["@_href"]);
      if (!href) continue;
      links.push({ href, mimeType: type, rel });
      continue;
    }
    // Navigation: an explicit subsection, or an opds-catalog-profile link that isn't acquisition.
    if (!navigation && (rel === "subsection" || /profile=opds-catalog/i.test(type))) {
      navigation = sanitizeUrl(l["@_href"]);
      continue;
    }
    if (rel === "alternate" || rel === "self") {
      if (!canonical) canonical = sanitizeUrl(l["@_href"]);
    }
  }
  return { links, cover, canonical, navigation };
}
```

In `toEntry`, destructure and set the field:

```typescript
  const { links, cover, canonical, navigation } = parseLinks(raw);
```
and add to the returned object (after `canonicalUrl`):
```typescript
    canonicalUrl: canonical,
    navigationUrl: navigation,
```

**Also** update any other `FeedEntry` object literals the tsc build flags — search: `npx tsc --noEmit -p tsconfig.json` will list files constructing `FeedEntry` without `navigationUrl` (test fixtures included). Add `navigationUrl: null` to each. (Known: several `__tests__` fixtures build entries inline.)

- [ ] **Step 4: Run to verify pass** — `npx jest src/openshelves/__tests__/opds12.test.ts && npx tsc --noEmit -p tsconfig.json` → tests pass, tsc clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/types.ts mobile/src/openshelves/opds12.ts mobile/src/openshelves/__tests__/
git commit -m "feat(open-shelves): parse OPDS subsection links into FeedEntry.navigationUrl"
```

---

### Task 2: EntryRow shows a browse affordance for navigation entries

**Files:**
- Modify: `mobile/src/openshelves/EntryRow.tsx`
- Test: `mobile/src/openshelves/__tests__/EntryRow.test.tsx` (extend)

**Interfaces:**
- Consumes: `FeedEntry.navigationUrl` (Task 1).
- Produces: EntryRow renders "Browse ›" (testID `entry-browse`) instead of the media badge when the entry is a navigation node (`navigationUrl` set AND no acquisition link).

- [ ] **Step 1: Write the failing test** — add to `EntryRow.test.tsx`:

```tsx
const nav = (over = {}) => ({
  id: "n1", title: "Whale books", authors: [], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "other" as const, rightsText: null, mature: null, links: [],
  canonicalUrl: null, navigationUrl: "/sub.opds", ...over,
});

test("a navigation entry shows a Browse affordance, not a media badge", () => {
  const { getByTestId, queryByText } = render(<EntryRow entry={nav()} onPress={jest.fn()} />);
  expect(getByTestId("entry-browse")).toBeTruthy();
  expect(queryByText("other")).toBeNull();
});

test("a leaf entry shows its media badge, no Browse affordance", () => {
  const leaf = nav({ navigationUrl: null, mediaType: "book" as const,
    links: [{ href: "/a.epub", mimeType: "application/epub+zip", rel: "acquisition" }] });
  const { getByText, queryByTestId } = render(<EntryRow entry={leaf} onPress={jest.fn()} />);
  expect(getByText("book")).toBeTruthy();
  expect(queryByTestId("entry-browse")).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest src/openshelves/__tests__/EntryRow.test.tsx` → FAIL (no `entry-browse`).

- [ ] **Step 3: Implement** — in `EntryRow.tsx`, replace the badge line:

```tsx
        <Text style={styles.title} numberOfLines={2}>{entry.title}</Text>
        <Text style={styles.author} numberOfLines={1}>{author}</Text>
        {entry.navigationUrl && entry.links.length === 0 ? (
          <Text testID="entry-browse" style={styles.browse}>Browse ›</Text>
        ) : (
          <Text style={styles.badge}>{entry.mediaType}</Text>
        )}
```

and add to `styles`:

```tsx
  browse: { color: colors.primary, fontSize: typography.sizeXs, fontWeight: "600", marginTop: 2 },
```

- [ ] **Step 4: Run to verify pass** — `npx jest src/openshelves/__tests__/EntryRow.test.tsx` → pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/EntryRow.tsx mobile/src/openshelves/__tests__/EntryRow.test.tsx
git commit -m "feat(open-shelves): Browse affordance for navigation catalog entries"
```

---

### Task 3: `useFeedBrowser` — the OPDS browse stack

**Files:**
- Create: `mobile/src/openshelves/useFeedBrowser.ts`
- Test: `mobile/src/openshelves/__tests__/useFeedBrowser.test.tsx`

**Interfaces:**
- Consumes: `fetchFeed` from `./fetchFeed`; `parseOpds12` from `./opds12`; `resolveUrl` from `./downloadTarget`; `toMessage` from `./errorMessage`; `FeedEntry` from `./types`.
- Produces:
  - `interface BrowseFrame { title: string; url: string; entries: FeedEntry[] }`
  - `useFeedBrowser(root: { title: string; url: string; entries: FeedEntry[] }): { frame: BrowseFrame; crumbs: string[]; canGoBack: boolean; loading: boolean; error: string | null; enter(entry: FeedEntry): Promise<void>; back(): void }`
  - `enter(entry)` — no-op unless `entry.navigationUrl` is set; resolves it against the **current frame's** url, `fetchFeed` + `parseOpds12`, pushes a frame. On failure sets `error` (via `toMessage`) and leaves the stack unchanged. `back()` pops one frame. Sub-feed entries are never stored.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/useFeedBrowser.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useFeedBrowser } from "../useFeedBrowser";

jest.mock("../fetchFeed", () => ({ fetchFeed: jest.fn() }));
jest.mock("../opds12", () => ({ parseOpds12: jest.fn() }));
import { fetchFeed } from "../fetchFeed";
import { parseOpds12 } from "../opds12";

const entry = (over: any = {}) => ({
  id: "e", title: "t", authors: [], summary: "", coverUrl: null, language: null, categories: [],
  mediaType: "other", rightsText: null, mature: null, links: [], canonicalUrl: null, navigationUrl: null, ...over,
});
const ROOT = { title: "Root", url: "https://ex.org/c.opds", entries: [entry({ id: "nav", navigationUrl: "/sub.opds" }), entry({ id: "leaf" })] };

beforeEach(() => jest.clearAllMocks());

test("enter a navigation entry pushes a frame of parsed sub-entries", async () => {
  (fetchFeed as jest.Mock).mockResolvedValue("<feed/>");
  (parseOpds12 as jest.Mock).mockReturnValue({ feedTitle: "Sub", entries: [entry({ id: "child" })] });
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[0]); });
  expect(fetchFeed).toHaveBeenCalledWith("https://ex.org/sub.opds"); // resolved against frame url
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["child"]);
  expect(result.current.canGoBack).toBe(true);
});

test("back pops to the parent frame", async () => {
  (fetchFeed as jest.Mock).mockResolvedValue("<feed/>");
  (parseOpds12 as jest.Mock).mockReturnValue({ feedTitle: "Sub", entries: [entry({ id: "child" })] });
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[0]); });
  act(() => { result.current.back(); });
  expect(result.current.frame.entries.map((e) => e.id)).toEqual(["nav", "leaf"]);
  expect(result.current.canGoBack).toBe(false);
});

test("entering a leaf entry does nothing (no navigationUrl)", async () => {
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[1]); });
  expect(fetchFeed).not.toHaveBeenCalled();
  expect(result.current.canGoBack).toBe(false);
});

test("a sub-feed fetch error sets error and keeps the stack", async () => {
  (fetchFeed as jest.Mock).mockRejectedValue(new Error("boom"));
  const { result } = renderHook(() => useFeedBrowser(ROOT));
  await act(async () => { await result.current.enter(ROOT.entries[0]); });
  await waitFor(() => expect(result.current.error).toMatch(/boom/));
  expect(result.current.canGoBack).toBe(false);
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest src/openshelves/__tests__/useFeedBrowser.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// mobile/src/openshelves/useFeedBrowser.ts
// An OPDS browse stack. The catalog is a tree of feeds; a navigation entry points
// to a sub-feed we fetch on demand (reusing the hardened fetchFeed/parseOpds12
// path — so web goes through the CORS proxy too). Sub-feed entries are transient:
// they live only in this stack, never in the per-source store (spec N2).
import { useCallback, useMemo, useState } from "react";
import { fetchFeed } from "./fetchFeed";
import { parseOpds12 } from "./opds12";
import { resolveUrl } from "./downloadTarget";
import { toMessage } from "./errorMessage";
import type { FeedEntry } from "./types";

export interface BrowseFrame {
  title: string;
  url: string;
  entries: FeedEntry[];
}

export function useFeedBrowser(root: BrowseFrame) {
  const [stack, setStack] = useState<BrowseFrame[]>([root]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const frame = stack[stack.length - 1];
  const crumbs = useMemo(() => stack.map((f) => f.title), [stack]);

  const enter = useCallback(async (entry: FeedEntry) => {
    if (!entry.navigationUrl) return;
    const url = resolveUrl(frame.url, entry.navigationUrl);
    if (!url) { setError("That catalog link isn't valid."); return; }
    setLoading(true);
    setError(null);
    try {
      const xml = await fetchFeed(url);
      const { entries } = parseOpds12(xml);
      setStack((s) => [...s, { title: entry.title, url, entries }]);
    } catch (err) {
      setError(toMessage(err));
    } finally {
      setLoading(false);
    }
  }, [frame.url]);

  const back = useCallback(() => {
    setError(null);
    setStack((s) => (s.length > 1 ? s.slice(0, -1) : s));
  }, []);

  return { frame, crumbs, canGoBack: stack.length > 1, loading, error, enter, back };
}
```

- [ ] **Step 4: Run to verify pass** — `npx jest src/openshelves/__tests__/useFeedBrowser.test.tsx && npx tsc --noEmit -p tsconfig.json` → pass, clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/useFeedBrowser.ts mobile/src/openshelves/__tests__/useFeedBrowser.test.tsx
git commit -m "feat(open-shelves): useFeedBrowser OPDS browse stack (transient sub-feeds)"
```

---

### Task 4: Wire the browse stack into the catalog screen

**Files:**
- Modify: `mobile/app/shelves/[sourceId].tsx`
- Test: `mobile/__tests__/app/shelves-catalog.test.tsx` (extend)

**Interfaces:**
- Consumes: `useSourceCatalog` (`{ source, entries, loading, … }`); `useFeedBrowser` (Task 3); `EntryRow` (Task 2).

**Notes:** The screen builds the root frame from the source (`{ title: source.title, url: source.url, entries }`) once loaded. A navigation entry tap → `browser.enter(entry)`; a leaf entry tap → `router.push('/shelves/{sourceId}/{entryId}')` as today. A Back control shows when `browser.canGoBack`. The root frame must rebuild when `useSourceCatalog` finishes loading (entries arrive async) — key `useFeedBrowser` off a stable root or reset when entries change.

- [ ] **Step 1: Write the failing test** — add to `shelves-catalog.test.tsx` (it already mocks `useSourceCatalog` and `expo-router`):

```tsx
test("tapping a navigation entry drills in; Back returns to the root", async () => {
  const nav = entry("nav"); (nav as any).navigationUrl = "/sub.opds";
  mockCatalog = { ...mockCatalog, source: { ...mockCatalog.source, url: "https://ex.org/c.opds" }, entries: [nav] };
  const fetchFeed = require("@/openshelves/fetchFeed").fetchFeed as jest.Mock;
  const parseOpds12 = require("@/openshelves/opds12").parseOpds12 as jest.Mock;
  fetchFeed.mockResolvedValue("<feed/>");
  parseOpds12.mockReturnValue({ feedTitle: "Sub", entries: [entry("child")] });

  const { getByTestId, findByTestId, queryByTestId } = render(<CatalogScreen />);
  fireEvent.press(getByTestId("entry-nav"));           // drill in
  expect(await findByTestId("entry-child")).toBeTruthy();
  expect(mockPush).not.toHaveBeenCalled();             // navigation ≠ open detail
  fireEvent.press(getByTestId("browse-back"));         // back to root
  expect(queryByTestId("entry-nav")).toBeTruthy();
});
```

Add near the top of the file (with the other `jest.mock`s):
```tsx
jest.mock("@/openshelves/fetchFeed", () => ({ fetchFeed: jest.fn() }));
jest.mock("@/openshelves/opds12", () => ({ parseOpds12: jest.fn() }));
```

- [ ] **Step 2: Run to verify fail** — `npx jest __tests__/app/shelves-catalog.test.tsx` → FAIL (no `browse-back` / drill-in).

- [ ] **Step 3: Implement** — rewrite the catalog screen's body to drive a browse frame. Key points: build the root frame from `cat.source`+`cat.entries`; feed it to `useFeedBrowser`; render `browser.frame.entries`; on press branch on `navigationUrl`.

```tsx
// mobile/app/shelves/[sourceId].tsx  (body)
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useSourceCatalog } from "@/openshelves/useSourceCatalog";
import { useFeedBrowser } from "@/openshelves/useFeedBrowser";
import { EntryRow } from "@/openshelves/EntryRow";

export default function CatalogScreen() {
  const { sourceId } = useLocalSearchParams<{ sourceId: string }>();
  const router = useRouter();
  const cat = useSourceCatalog(sourceId);

  const root = useMemo(
    () => ({ title: cat.source?.title ?? "Catalog", url: cat.source?.url ?? "", entries: cat.entries }),
    [cat.source?.title, cat.source?.url, cat.entries],
  );
  const browser = useFeedBrowser(root);
  const shown = browser.frame.entries;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>{browser.frame.title}</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{shown.length} items</Text>
          {browser.canGoBack ? (
            <Pressable testID="browse-back" onPress={browser.back}><Text style={styles.back}>‹ Back</Text></Pressable>
          ) : null}
        </View>
        {browser.error ? <Text style={styles.error}>{browser.error}</Text> : null}
        {cat.loading && shown.length === 0 ? null : shown.length === 0 ? (
          <Text style={styles.empty}>No items in this catalog.</Text>
        ) : (
          shown.map((e) => (
            <EntryRow
              key={e.id}
              entry={e}
              onPress={() => {
                if (e.navigationUrl && e.links.length === 0) void browser.enter(e);
                else router.push(`/shelves/${sourceId}/${e.id}`);
              }}
            />
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
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginVertical: spacing.sm },
  sub: { color: colors.textMuted, fontSize: typography.sizeMd },
  back: { color: colors.primary, fontSize: typography.sizeMd, fontWeight: "600" },
  error: { color: colors.error, fontSize: typography.sizeSm, marginBottom: spacing.sm },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
```

If the existing test referenced a source title element that moved, keep both the old assertions working (the source title now renders as `browser.frame.title`, which equals `source.title` at the root).

- [ ] **Step 4: Run to verify pass** — `npx jest __tests__/app/shelves-catalog.test.tsx && npx tsc --noEmit -p tsconfig.json` → pass, clean.

- [ ] **Step 5: Commit**

```bash
git add "mobile/app/shelves/[sourceId].tsx" mobile/__tests__/app/shelves-catalog.test.tsx
git commit -m "feat(open-shelves): browse OPDS navigation catalogs in the catalog screen"
```

---

### Task 5: `deviceLocale` + pure `filterEntries`

**Files:**
- Create: `mobile/src/openshelves/deviceLocale.ts`
- Create: `mobile/src/openshelves/filterEntries.ts`
- Test: `mobile/src/openshelves/__tests__/filterEntries.test.ts`

**Interfaces:**
- Produces:
  - `deviceLocale(raw?: string): string` — primary lowercase subtag. `raw` overrides the platform read (for tests). Platform: `navigator.language` (web) / `Intl.DateTimeFormat().resolvedOptions().locale` (native) / `"en"` fallback.
  - `interface ShelfPrefs { language: string; hideMature: boolean }` (`language` = a primary subtag or `"all"`).
  - `primarySubtag(lang: string): string`
  - `filterEntries(entries: FeedEntry[], prefs: ShelfPrefs): FeedEntry[]`

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/filterEntries.test.ts
import { filterEntries, primarySubtag, type ShelfPrefs } from "../filterEntries";
import { deviceLocale } from "../deviceLocale";
import type { FeedEntry } from "../types";

const e = (over: Partial<FeedEntry>): FeedEntry => ({
  id: Math.random().toString(), title: "t", authors: [], summary: "", coverUrl: null,
  language: null, categories: [], mediaType: "book", rightsText: null, mature: null,
  links: [], canonicalUrl: null, navigationUrl: null, ...over,
});
const prefs = (over: Partial<ShelfPrefs> = {}): ShelfPrefs => ({ language: "all", hideMature: true, ...over });

test("primarySubtag lowercases and strips region", () => {
  expect(primarySubtag("en-US")).toBe("en");
  expect(primarySubtag("FR")).toBe("fr");
});

test("language filter keeps matches and unknown-language entries, drops mismatches", () => {
  const list = [e({ id: "en", language: "en" }), e({ id: "fr", language: "fr-FR" }), e({ id: "unk", language: null })];
  const kept = filterEntries(list, prefs({ language: "en" })).map((x) => x.id);
  expect(kept).toEqual(["en", "unk"]); // fr dropped, unknown kept
});

test("language 'all' disables the language filter", () => {
  const list = [e({ language: "en" }), e({ language: "fr" })];
  expect(filterEntries(list, prefs({ language: "all" }))).toHaveLength(2);
});

test("hideMature drops only mature===true; keeps false and null", () => {
  const list = [e({ id: "m", mature: true }), e({ id: "ok", mature: false }), e({ id: "unk", mature: null })];
  expect(filterEntries(list, prefs({ hideMature: true })).map((x) => x.id)).toEqual(["ok", "unk"]);
  expect(filterEntries(list, prefs({ hideMature: false }))).toHaveLength(3);
});

test("language + maturity compose", () => {
  const list = [e({ id: "keep", language: "en", mature: false }), e({ id: "mat", language: "en", mature: true }), e({ id: "fr", language: "fr" })];
  expect(filterEntries(list, prefs({ language: "en", hideMature: true })).map((x) => x.id)).toEqual(["keep"]);
});

test("deviceLocale reduces a raw locale to its primary subtag", () => {
  expect(deviceLocale("en-GB")).toBe("en");
  expect(deviceLocale("")).toBe("en"); // fallback
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest src/openshelves/__tests__/filterEntries.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement**

```typescript
// mobile/src/openshelves/deviceLocale.ts
// Primary language subtag for the device, as the DEFAULT filter language. Declared,
// not tracked (ADR-028 §6b): it only seeds the default; the user changes it in the
// filter bar. No expo-localization dependency (spec F4).
import { Platform } from "react-native";

export function deviceLocale(raw?: string): string {
  let value = raw;
  if (value === undefined) {
    try {
      if (Platform.OS === "web") {
        value = (globalThis as any).navigator?.language;
      } else {
        value = Intl.DateTimeFormat().resolvedOptions().locale;
      }
    } catch {
      value = undefined;
    }
  }
  const primary = (value ?? "").split(/[-_]/)[0].trim().toLowerCase();
  return primary || "en";
}
```

```typescript
// mobile/src/openshelves/filterEntries.ts
// Pure client-side content filter (ADR-028 §6b): a total function of device-local
// declared prefs × feed metadata. Unknown language/maturity is KEPT — never hide a
// book because its metadata is missing.
import type { FeedEntry } from "./types";

export interface ShelfPrefs {
  language: string; // a primary subtag ("en") or the literal "all"
  hideMature: boolean;
}

export function primarySubtag(lang: string): string {
  return (lang ?? "").split(/[-_]/)[0].trim().toLowerCase();
}

export function filterEntries(entries: FeedEntry[], prefs: ShelfPrefs): FeedEntry[] {
  return entries.filter((e) => {
    if (prefs.hideMature && e.mature === true) return false;
    if (prefs.language !== "all" && e.language) {
      if (primarySubtag(e.language) !== prefs.language) return false;
    }
    return true;
  });
}
```

- [ ] **Step 4: Run to verify pass** — `npx jest src/openshelves/__tests__/filterEntries.test.ts && npx tsc --noEmit -p tsconfig.json` → pass, clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/deviceLocale.ts mobile/src/openshelves/filterEntries.ts mobile/src/openshelves/__tests__/filterEntries.test.ts
git commit -m "feat(open-shelves): pure language+maturity filter + device-locale default"
```

---

### Task 6: Prefs store + `useShelfPrefs`

**Files:**
- Create: `mobile/src/openshelves/shelfPrefsStore.ts`
- Create: `mobile/src/openshelves/useShelfPrefs.ts`
- Test: `mobile/src/openshelves/__tests__/shelfPrefsStore.test.ts`

**Interfaces:**
- Consumes: `ShelfPrefs` from `./filterEntries`; `deviceLocale` from `./deviceLocale`.
- Produces:
  - `defaultPrefs(): ShelfPrefs` — `{ language: deviceLocale(), hideMature: true }`.
  - `getPrefs(): Promise<ShelfPrefs>` — persisted value, else `defaultPrefs()`; corrupt → `defaultPrefs()`.
  - `putPrefs(prefs: ShelfPrefs): Promise<void>`.
  - `useShelfPrefs(): { prefs: ShelfPrefs; setPrefs(p: ShelfPrefs): Promise<void>; loading: boolean }`.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/shelfPrefsStore.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getPrefs, putPrefs, defaultPrefs } from "../shelfPrefsStore";

beforeEach(async () => { await AsyncStorage.clear(); });

test("absent → defaults (hideMature true, a language string)", async () => {
  const p = await getPrefs();
  expect(p.hideMature).toBe(true);
  expect(typeof p.language).toBe("string");
  expect(p).toEqual(defaultPrefs());
});

test("round-trips a saved pref", async () => {
  await putPrefs({ language: "fr", hideMature: false });
  expect(await getPrefs()).toEqual({ language: "fr", hideMature: false });
});

test("corrupt blob → defaults", async () => {
  await AsyncStorage.setItem("sbq_open_shelves_prefs", "not json");
  expect(await getPrefs()).toEqual(defaultPrefs());
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest src/openshelves/__tests__/shelfPrefsStore.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```typescript
// mobile/src/openshelves/shelfPrefsStore.ts
// Device-local, declared filter prefs (ADR-028 §6b/F3). Never synced, never inferred.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { deviceLocale } from "./deviceLocale";
import type { ShelfPrefs } from "./filterEntries";

const KEY = "sbq_open_shelves_prefs";

export function defaultPrefs(): ShelfPrefs {
  return { language: deviceLocale(), hideMature: true };
}

export async function getPrefs(): Promise<ShelfPrefs> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return defaultPrefs();
  try {
    const p = JSON.parse(raw);
    if (typeof p?.language === "string" && typeof p?.hideMature === "boolean") {
      return { language: p.language, hideMature: p.hideMature };
    }
    return defaultPrefs();
  } catch {
    return defaultPrefs();
  }
}

export async function putPrefs(prefs: ShelfPrefs): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(prefs));
}
```

```typescript
// mobile/src/openshelves/useShelfPrefs.ts
import { useCallback, useEffect, useState } from "react";
import { defaultPrefs, getPrefs, putPrefs } from "./shelfPrefsStore";
import type { ShelfPrefs } from "./filterEntries";

export function useShelfPrefs() {
  const [prefs, setState] = useState<ShelfPrefs>(defaultPrefs());
  const [loading, setLoading] = useState(true);

  useEffect(() => { void (async () => { setState(await getPrefs()); setLoading(false); })(); }, []);

  const setPrefs = useCallback(async (p: ShelfPrefs) => {
    setState(p);
    await putPrefs(p);
  }, []);

  return { prefs, setPrefs, loading };
}
```

- [ ] **Step 4: Run to verify pass** — `npx jest src/openshelves/__tests__/shelfPrefsStore.test.ts && npx tsc --noEmit -p tsconfig.json` → pass, clean.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/shelfPrefsStore.ts mobile/src/openshelves/useShelfPrefs.ts mobile/src/openshelves/__tests__/shelfPrefsStore.test.ts
git commit -m "feat(open-shelves): device-local shelf filter prefs store + hook"
```

---

### Task 7: `ShelfFilterBar` + wire the filter into the catalog

**Files:**
- Create: `mobile/src/openshelves/ShelfFilterBar.tsx`
- Modify: `mobile/app/shelves/[sourceId].tsx`
- Test: `mobile/src/openshelves/__tests__/ShelfFilterBar.test.tsx`

**Interfaces:**
- Consumes: `ShelfPrefs`, `filterEntries` (Task 5); `useShelfPrefs` (Task 6); `FeedEntry`.
- Produces: `ShelfFilterBar({ entries, prefs, onChange }: { entries: FeedEntry[]; prefs: ShelfPrefs; onChange(p: ShelfPrefs): void })` — a language picker (choices = the primary subtags present in `entries` + `"all"`, labelled "All") and a "Hide mature" toggle. It is presentational — the screen owns the persisted prefs and does the filtering.

- [ ] **Step 1: Write the failing test**

```tsx
// mobile/src/openshelves/__tests__/ShelfFilterBar.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
import { ShelfFilterBar } from "../ShelfFilterBar";

const e = (id: string, language: string | null) => ({
  id, title: id, authors: [], summary: "", coverUrl: null, language, categories: [],
  mediaType: "book" as const, rightsText: null, mature: null, links: [], canonicalUrl: null, navigationUrl: null,
});
const entries = [e("a", "en"), e("b", "fr-FR"), e("c", null)];

test("offers All + the primary subtags present, and reports a language pick", () => {
  const onChange = jest.fn();
  const { getByTestId } = render(
    <ShelfFilterBar entries={entries} prefs={{ language: "all", hideMature: true }} onChange={onChange} />,
  );
  expect(getByTestId("lang-all")).toBeTruthy();
  expect(getByTestId("lang-en")).toBeTruthy();
  expect(getByTestId("lang-fr")).toBeTruthy();
  fireEvent.press(getByTestId("lang-fr"));
  expect(onChange).toHaveBeenCalledWith({ language: "fr", hideMature: true });
});

test("toggles hideMature", () => {
  const onChange = jest.fn();
  const { getByTestId } = render(
    <ShelfFilterBar entries={entries} prefs={{ language: "all", hideMature: true }} onChange={onChange} />,
  );
  fireEvent.press(getByTestId("toggle-mature"));
  expect(onChange).toHaveBeenCalledWith({ language: "all", hideMature: false });
});
```

- [ ] **Step 2: Run to verify fail** — `npx jest src/openshelves/__tests__/ShelfFilterBar.test.tsx` → FAIL (module missing).

- [ ] **Step 3: Implement `ShelfFilterBar`**

```tsx
// mobile/src/openshelves/ShelfFilterBar.tsx
// Inline catalog filter (ADR-028 §6b). Presentational: language chips (the subtags
// actually present + "All") and a Hide-mature toggle. The screen owns persistence.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/constants/theme";
import { primarySubtag, type ShelfPrefs } from "./filterEntries";
import type { FeedEntry } from "./types";

interface Props {
  entries: FeedEntry[];
  prefs: ShelfPrefs;
  onChange: (p: ShelfPrefs) => void;
}

export function ShelfFilterBar({ entries, prefs, onChange }: Props) {
  const langs = Array.from(
    new Set(entries.map((e) => (e.language ? primarySubtag(e.language) : null)).filter((l): l is string => !!l)),
  ).sort();
  const choices: string[] = ["all", ...langs];

  return (
    <View style={styles.bar}>
      <View style={styles.chips}>
        {choices.map((c) => {
          const selected = prefs.language === c;
          return (
            <Pressable
              key={c}
              testID={`lang-${c}`}
              style={[styles.chip, selected && styles.chipOn]}
              onPress={() => onChange({ ...prefs, language: c })}
            >
              <Text style={[styles.chipText, selected && styles.chipTextOn]}>{c === "all" ? "All" : c.toUpperCase()}</Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable testID="toggle-mature" style={styles.toggle} onPress={() => onChange({ ...prefs, hideMature: !prefs.hideMature })}>
        <Text style={styles.toggleText}>{prefs.hideMature ? "☑ Hide mature" : "☐ Hide mature"}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { gap: spacing.sm, marginBottom: spacing.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.textMuted, fontSize: typography.sizeSm },
  chipTextOn: { color: colors.primaryText, fontWeight: "600" },
  toggle: { alignSelf: "flex-start" },
  toggleText: { color: colors.text, fontSize: typography.sizeSm },
});
```

- [ ] **Step 4: Wire into the catalog screen** — in `mobile/app/shelves/[sourceId].tsx`, apply the filter to the current frame and render the bar. Add imports:

```tsx
import { ShelfFilterBar } from "@/openshelves/ShelfFilterBar";
import { useShelfPrefs } from "@/openshelves/useShelfPrefs";
import { filterEntries } from "@/openshelves/filterEntries";
```

In the component body, after `const browser = useFeedBrowser(root);`:

```tsx
  const { prefs, setPrefs } = useShelfPrefs();
  const shown = filterEntries(browser.frame.entries, prefs);
```

(remove the old `const shown = browser.frame.entries;`). Render the bar above the list and show a filtered/total count:

```tsx
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{shown.length} of {browser.frame.entries.length} shown</Text>
          {browser.canGoBack ? (
            <Pressable testID="browse-back" onPress={browser.back}><Text style={styles.back}>‹ Back</Text></Pressable>
          ) : null}
        </View>
        <ShelfFilterBar entries={browser.frame.entries} prefs={prefs} onChange={(p) => void setPrefs(p)} />
```

- [ ] **Step 5: Run to verify pass** — `npx jest src/openshelves __tests__/app && npx tsc --noEmit -p tsconfig.json` → all pass, clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/ShelfFilterBar.tsx "mobile/app/shelves/[sourceId].tsx" mobile/src/openshelves/__tests__/ShelfFilterBar.test.tsx
git commit -m "feat(open-shelves): inline language+maturity filter bar on the catalog"
```

---

### Task 8: Live verification (manual, no commit)

> The servers are already up (backend `:8001` + fresh redis `:6380` + expo web `:8082`). If not, restart per the resume pin.

- [ ] Web: Shelves → add `https://m.gutenberg.org/ebooks/search.opds/?query=whale` → the catalog lists entries showing **"Browse ›"** (navigation nodes).
- [ ] Tap one → its per-book editions load in place; a **‹ Back** control appears; Back returns to the catalog.
- [ ] Open a leaf (book) entry → **Download** pulls the EPUB from `gutenberg.org` (network panel shows the source host, NOT `localhost:8001`).
- [ ] The filter bar shows language chips (**All** + the subtags present) and **Hide mature**; picking a language narrows the list and the "N of M shown" count updates; the choice persists across a reload.
- [ ] Android (optional, if a device/emulator is handy): the same drill-in works fetching direct (no backend), confirming the browse path reuses `feedTransport` correctly.

---

## What this plan leaves to later

- Subject (F-2) and media-type (F-3) filters; a global Settings-level preference; OPDS 2.0 (JSON) feeds; persisting drilled-in sub-feeds; server-side/URL-param filtering.
- **Starter list (P0-5)** — now unblocked for navigation catalogs (Gutenberg becomes usable), but still its own plan; re-verify feed liveness + that entries reach acquisition links within a couple of drill levels.

## Self-Review

**Spec coverage:** N1 browse-in-place → Task 3/4; N2 transient sub-feeds → Task 3 (`useFeedBrowser` never writes the store; test asserts no store write via not mocking/among the mocks) + Task 4; N3 reuse fetchFeed/feedTransport → Task 3 (imports `fetchFeed`, `parseOpds12`); F1 language+maturity → Task 5; F2 pure/unknown-kept → Task 5 (`filterEntries` + tests for null-kept); F3 device-local declared persisted → Task 6; F4 no-dep locale → Task 5 (`deviceLocale`). Parser gap (dropped subsection) → Task 1. Filter bar + "N of M" → Task 7. Live proof → Task 8.

**Placeholder scan:** none — every code step carries complete code; Task 8 is a manual checklist by design.

**Type consistency:** `FeedEntry.navigationUrl` (Task 1) is read by EntryRow (Task 2), `useFeedBrowser.enter` (Task 3), and the screen's press branch (Task 4/7). `BrowseFrame{title,url,entries}` (Task 3) is built by the screen (Task 4). `ShelfPrefs{language,hideMature}` (Task 5) flows through `filterEntries` (Task 5), the prefs store (Task 6), `useShelfPrefs` (Task 6), and `ShelfFilterBar` (Task 7). `deviceLocale()` (Task 5) is used by `defaultPrefs` (Task 6). `primarySubtag` (Task 5) is used by `filterEntries` (Task 5) and `ShelfFilterBar` (Task 7). `parseOpds12`/`fetchFeed`/`resolveUrl`/`toMessage` are existing exports.
