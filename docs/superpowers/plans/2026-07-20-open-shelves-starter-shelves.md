# Open Shelves — Starter Shelves Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seed four curated Project Gutenberg shelves into Open Shelves on first run so a new user sees real, downloadable books instead of an empty tab.

**Architecture:** A bundled constant (`STARTER_SOURCES`) is written directly into the existing feed-sources store at app start — offline, idempotent, deletion-safe (a marker key). Seeded rows carry `lastRefreshedAt: null`; the catalog hook fetches each lazily on first open. A "Curated by Mentible" badge + a "Restore starter sources" action expose the new `isStarter` flag. A descriptive User-Agent is added to both feed-fetch paths.

**Tech Stack:** React Native + Expo · TypeScript · `@react-native-async-storage/async-storage` · jest-expo + `@testing-library/react-native` · FastAPI + httpx (backend UA). All mobile commands run from `mobile/`; backend from repo root via `.venv`.

## Global Constraints

- **Feeds ship only if verified live + reaching acquisition links.** The four starter URLs (Task 1) were verified 2026-07-20; re-verify before ship. No test hits a live feed — CI never touches the network.
- **Seeding makes NO network call, ever** (spec D-S4). It writes AsyncStorage only. A `fetchFeed` spy asserts this.
- **A removed starter shelf is never resurrected** (spec D-S3) — idempotency + deletion-safety via the `sbq_seeded_shelves` marker.
- **Help must track the capability** (`CLAUDE.md` DoD + `starter-claim.test.ts`): once `STARTER_SOURCES` is non-empty, a Help topic MUST affirm curated/starter sources (match `/starter/i`, `/curated by us/i`, or `/we curate/i`). Populating the array and updating the copy are ONE task (Task 1) so `main` never has the array non-empty with stale copy.
- **`FeedSource` shape** (verbatim, `mobile/src/openshelves/types.ts`): `{ id: string; url: string; title: string | null; addedAt: string; lastRefreshedAt: string | null; isStarter: boolean; entryCount: number }`.
- **Marker key:** `sbq_seeded_shelves` (list of seeded URLs). Distinct from the library seeder's `sbq_seeded_library`.
- **Feed User-Agent** (verbatim): `Mentible (+https://mambakkam.net/mentible)`.

---

### Task 1: Populate STARTER_SOURCES + update Help copy (coupled)

**Files:**
- Modify: `mobile/src/openshelves/starterSources.ts`
- Modify: `mobile/src/help-content/topics.ts:354-372` (the `open-shelves` topic text + "Is a source curated?" def)
- Test: `mobile/__tests__/help/starter-claim.test.ts` (existing — must flip from the empty-array branch to the non-empty branch)

**Interfaces:**
- Produces: `STARTER_SOURCES: StarterSource[]` (non-empty) consumed by Tasks 2 & 3.

- [ ] **Step 1: Run the existing gate to see the current (empty-array) branch pass**

Run: `npx jest __tests__/help/starter-claim.test.ts`
Expected: PASS (currently `STARTER_SOURCES.length === 0`, so the copy must NOT promise curation — and it doesn't).

- [ ] **Step 2: Populate `STARTER_SOURCES`**

Replace the empty array in `mobile/src/openshelves/starterSources.ts` (keep the `StarterSource` interface and the file's doc comment intact):

```ts
export const STARTER_SOURCES: StarterSource[] = [
  { url: "https://www.gutenberg.org/ebooks/search.opds/?sort_order=downloads", title: "Project Gutenberg — Popular" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=science",       title: "Project Gutenberg — Science" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=children",      title: "Project Gutenberg — Children's" },
  { url: "https://www.gutenberg.org/ebooks/search.opds/?query=history",       title: "Project Gutenberg — History" },
];
```

- [ ] **Step 3: Run the gate to verify it now FAILS (copy is stale)**

Run: `npx jest __tests__/help/starter-claim.test.ts`
Expected: FAIL — `STARTER_SOURCES` is non-empty so the test now requires a topic promising curation, and none does yet.

- [ ] **Step 4: Update the `open-shelves` Help topic copy**

In `mobile/src/help-content/topics.ts`, replace the first text block (line ~355):

```ts
        text: "Open Shelves lets you add free book catalogs (OPDS feeds), then browse and manage them from the Shelves tab. A few starter libraries — Project Gutenberg shelves, curated by us — come included, so you always have somewhere to start. You can also add your own: paste an OPDS catalog URL.",
```

And replace the "Is a source curated?" def (line ~370-371) — the old "every catalog is one you added yourself" is now false:

```ts
          {
            term: "Is a source curated?",
            def: "The starter shelves (Project Gutenberg) are curated by us. Any source you add yourself is outside Mentible's curation and is your responsibility — we don't vet or moderate third-party feeds.",
          },
```

- [ ] **Step 5: Run the gate + coverage to verify both pass**

Run: `npx jest __tests__/help/starter-claim.test.ts __tests__/help/coverage.test.ts`
Expected: PASS — the topic now matches `/starter/i` and `/curated by us/i` (non-empty branch satisfied), and the feature↔topic mapping is intact.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/starterSources.ts mobile/src/help-content/topics.ts
git commit -m "feat(open-shelves): seed 4 Gutenberg starter shelves (data) + curation Help copy"
```

---

### Task 2: `seedStarterSources` + `restoreStarterSources` (offline, idempotent)

**Files:**
- Create: `mobile/src/openshelves/seedStarterSources.ts`
- Test: `mobile/src/openshelves/__tests__/seedStarterSources.test.ts`

**Interfaces:**
- Consumes: `STARTER_SOURCES` (Task 1); `listSources`, `putSource` from `./feedSourcesStore`; `randomUUID` from `@/lib/uuid`.
- Produces:
  - `seedStarterSources(opts?: SeedStarterOpts): Promise<SeedResult>`
  - `restoreStarterSources(opts?: SeedStarterOpts): Promise<SeedResult>`
  - `interface SeedResult { seeded: string[]; skipped: string[] }` (URLs)
  - `interface SeedStarterOpts { now?: () => string; newId?: () => string }`
  - Marker key constant not exported.

- [ ] **Step 1: Write the failing tests**

Create `mobile/src/openshelves/__tests__/seedStarterSources.test.ts`:

```ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { seedStarterSources, restoreStarterSources } from "../seedStarterSources";
import { STARTER_SOURCES } from "../starterSources";
import { listSources, deleteSourceRecord } from "../feedSourcesStore";
import * as fetchFeedMod from "../fetchFeed";

const opts = { now: () => "2026-07-20T00:00:00.000Z", newId: (() => { let n = 0; return () => `id-${n++}`; })() };

beforeEach(async () => { await AsyncStorage.clear(); });

it("seeds every starter shelf on a clean install, marked isStarter", async () => {
  const res = await seedStarterSources(opts);
  expect(res.seeded.sort()).toEqual(STARTER_SOURCES.map((s) => s.url).sort());
  const sources = await listSources();
  expect(sources).toHaveLength(STARTER_SOURCES.length);
  for (const s of sources) {
    expect(s.isStarter).toBe(true);
    expect(s.lastRefreshedAt).toBeNull();
    expect(s.entryCount).toBe(0);
  }
});

it("is idempotent — a second run writes nothing", async () => {
  await seedStarterSources(opts);
  const res2 = await seedStarterSources(opts);
  expect(res2.seeded).toEqual([]);
  expect(await listSources()).toHaveLength(STARTER_SOURCES.length);
});

it("does NOT resurrect a removed shelf", async () => {
  await seedStarterSources(opts);
  const [first] = await listSources();
  await deleteSourceRecord(first.id);
  await seedStarterSources(opts);
  const urls = (await listSources()).map((s) => s.url);
  expect(urls).not.toContain(first.url);
  expect(urls).toHaveLength(STARTER_SOURCES.length - 1);
});

it("makes NO network call during seeding", async () => {
  const spy = jest.spyOn(fetchFeedMod, "fetchFeed");
  await seedStarterSources(opts);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it("restore re-adds only the removed shelf, without clobbering kept ones", async () => {
  await seedStarterSources(opts);
  const before = await listSources();
  const kept = before.find((s) => s.url.includes("science"))!;
  const removed = before.find((s) => s.url.includes("history"))!;
  await deleteSourceRecord(removed.id);
  const res = await restoreStarterSources(opts);
  expect(res.seeded).toEqual([removed.url]);
  const after = await listSources();
  expect(after.map((s) => s.url).sort()).toEqual(STARTER_SOURCES.map((s) => s.url).sort());
  // the kept shelf's row is untouched (same id)
  expect(after.find((s) => s.url === kept.url)!.id).toBe(kept.id);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/openshelves/__tests__/seedStarterSources.test.ts`
Expected: FAIL — "Cannot find module '../seedStarterSources'".

- [ ] **Step 3: Implement `seedStarterSources.ts`**

Create `mobile/src/openshelves/seedStarterSources.ts`:

```ts
// First-run seeder for the owner-curated starter shelves (spec P0-5, ADR-028).
// Writes FeedSource rows directly — NO network at startup (D-S4). Idempotent and
// deletion-safe via a persisted marker of seeded URLs (D-S3): a removed shelf is
// not resurrected. Fetch happens lazily on first open (useSourceCatalog).
import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "@/lib/uuid";
import type { FeedSource } from "./types";
import { STARTER_SOURCES } from "./starterSources";
import { listSources, putSource } from "./feedSourcesStore";

const MARKER_KEY = "sbq_seeded_shelves";

export interface SeedResult { seeded: string[]; skipped: string[] }
export interface SeedStarterOpts { now?: () => string; newId?: () => string }

async function loadMarker(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(MARKER_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

async function saveMarker(urls: string[]): Promise<void> {
  await AsyncStorage.setItem(MARKER_KEY, JSON.stringify(urls));
}

function newRow(url: string, title: string, opts: SeedStarterOpts): FeedSource {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? randomUUID;
  return { id: newId(), url, title, addedAt: now(), lastRefreshedAt: null, isStarter: true, entryCount: 0 };
}

/** Seed starter shelves not yet marked. Idempotent + deletion-safe. No network. */
export async function seedStarterSources(opts: SeedStarterOpts = {}): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [] };
  const marker = await loadMarker();
  for (const src of STARTER_SOURCES) {
    if (marker.includes(src.url)) { result.skipped.push(src.url); continue; }
    await putSource(newRow(src.url, src.title, opts));
    marker.push(src.url);
    result.seeded.push(src.url);
  }
  if (result.seeded.length > 0) await saveMarker(marker);
  return result;
}

/** Re-add starter shelves the user removed, without clobbering kept ones. */
export async function restoreStarterSources(opts: SeedStarterOpts = {}): Promise<SeedResult> {
  const result: SeedResult = { seeded: [], skipped: [] };
  const present = new Set((await listSources()).map((s) => s.url));
  const marker = await loadMarker();
  for (const src of STARTER_SOURCES) {
    if (present.has(src.url)) { result.skipped.push(src.url); continue; }
    await putSource(newRow(src.url, src.title, opts));
    if (!marker.includes(src.url)) marker.push(src.url);
    result.seeded.push(src.url);
  }
  if (result.seeded.length > 0) await saveMarker(marker);
  return result;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/openshelves/__tests__/seedStarterSources.test.ts`
Expected: PASS (all 5).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/seedStarterSources.ts mobile/src/openshelves/__tests__/seedStarterSources.test.ts
git commit -m "feat(open-shelves): offline idempotent seedStarterSources + restore"
```

---

### Task 3: Wire seeding into app start (`useSeedStarterSources`)

**Files:**
- Create: `mobile/src/hooks/useSeedStarterSources.ts`
- Modify: `mobile/app/_layout.tsx:20` (call the hook next to `useSeedDefaultLibrary()`)
- Test: `mobile/src/openshelves/__tests__/useSeedStarterSources.test.ts`

**Interfaces:**
- Consumes: `seedStarterSources` (Task 2).
- Produces: `useSeedStarterSources(): void`.

- [ ] **Step 1: Write the failing test**

Create `mobile/src/openshelves/__tests__/useSeedStarterSources.test.ts`:

```ts
import { renderHook } from "@testing-library/react-native";
import { useSeedStarterSources } from "@/hooks/useSeedStarterSources";
import * as seed from "../seedStarterSources";

it("calls seedStarterSources once on mount and swallows errors", async () => {
  const spy = jest.spyOn(seed, "seedStarterSources").mockRejectedValue(new Error("boom"));
  renderHook(() => useSeedStarterSources());
  expect(spy).toHaveBeenCalledTimes(1);
  await Promise.resolve();
  spy.mockRestore();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/openshelves/__tests__/useSeedStarterSources.test.ts`
Expected: FAIL — "Cannot find module '@/hooks/useSeedStarterSources'".

- [ ] **Step 3: Implement the hook**

Create `mobile/src/hooks/useSeedStarterSources.ts` (mirrors `useSeedDefaultLibrary`):

```ts
import { useEffect } from "react";
import { seedStarterSources } from "@/openshelves/seedStarterSources";

// Seed the owner-curated starter shelves once per app start. Idempotent and
// deletion-safe (see seedStarterSources). Must never crash launch — swallow errors.
export function useSeedStarterSources(): void {
  useEffect(() => {
    void seedStarterSources().catch(() => {
      // A failed seed must not block app start; the user can still add sources.
    });
  }, []);
}
```

- [ ] **Step 4: Wire it into `_layout.tsx`**

In `mobile/app/_layout.tsx`, add the import and call it beside `useSeedDefaultLibrary()`:

```tsx
import { useSeedStarterSources } from "@/hooks/useSeedStarterSources";
// ...inside the component, next to useSeedDefaultLibrary():
  useSeedDefaultLibrary();
  useSeedStarterSources();
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx jest src/openshelves/__tests__/useSeedStarterSources.test.ts && npx tsc --noEmit`
Expected: PASS, tsc clean.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/hooks/useSeedStarterSources.ts mobile/app/_layout.tsx mobile/src/openshelves/__tests__/useSeedStarterSources.test.ts
git commit -m "feat(open-shelves): seed starter shelves at app start"
```

---

### Task 4: Lazy hydration on first open (`useSourceCatalog`)

**Files:**
- Modify: `mobile/src/openshelves/useSourceCatalog.ts`
- Test: `mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx` (existing — add cases)

**Interfaces:**
- Consumes: existing `refresh` + `source`/`entries`/`loading` from the hook.
- Produces: no new export — behavior only (auto-`refresh()` once for a never-refreshed, empty source).

- [ ] **Step 1: Write the failing tests** (append to the existing test file)

```tsx
import { renderHook, waitFor } from "@testing-library/react-native";
import { useSourceCatalog } from "../useSourceCatalog";
import * as feedStore from "../feedStore";
import { putSource } from "../feedSourcesStore";
import AsyncStorage from "@react-native-async-storage/async-storage";

describe("lazy hydration", () => {
  beforeEach(async () => { await AsyncStorage.clear(); jest.restoreAllMocks(); });

  it("fetches once on first open of a never-refreshed empty source", async () => {
    await putSource({ id: "s1", url: "https://x/f", title: "X", addedAt: "t", lastRefreshedAt: null, isStarter: true, entryCount: 0 });
    const spy = jest.spyOn(feedStore, "refreshSource").mockResolvedValue({ added: 1, updated: 0, removed: 0 });
    renderHook(() => useSourceCatalog("s1"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("does NOT loop when hydration fails", async () => {
    await putSource({ id: "s2", url: "https://x/f", title: "X", addedAt: "t", lastRefreshedAt: null, isStarter: true, entryCount: 0 });
    const spy = jest.spyOn(feedStore, "refreshSource").mockRejectedValue(new Error("down"));
    const { rerender } = renderHook(() => useSourceCatalog("s2"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    rerender({});
    rerender({});
    expect(spy).toHaveBeenCalledTimes(1); // terminal until user taps Refresh
  });

  it("does NOT auto-fetch an already-refreshed source", async () => {
    await putSource({ id: "s3", url: "https://x/f", title: "X", addedAt: "t", lastRefreshedAt: "2026-01-01", isStarter: false, entryCount: 5 });
    const spy = jest.spyOn(feedStore, "refreshSource").mockResolvedValue({ added: 0, updated: 0, removed: 0 });
    renderHook(() => useSourceCatalog("s3"));
    await new Promise((r) => setTimeout(r, 50));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/openshelves/__tests__/useSourceCatalog.test.tsx -t "lazy hydration"`
Expected: FAIL — first test: `refreshSource` not called (no hydration yet).

- [ ] **Step 3: Implement lazy hydration**

In `mobile/src/openshelves/useSourceCatalog.ts`, add `useRef` to the import and insert a hydration effect after the existing `useEffect(() => { void reload(); }, [reload]);`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
// ...
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (loading || !source) return;
    if (source.lastRefreshedAt !== null || entries.length > 0) return;
    if (hydratedFor.current === sourceId) return; // one attempt per source; terminal on failure
    hydratedFor.current = sourceId;
    void refresh();
  }, [loading, source, entries.length, sourceId, refresh]);
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/openshelves/__tests__/useSourceCatalog.test.tsx`
Expected: PASS (new cases + existing).

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/useSourceCatalog.ts mobile/src/openshelves/__tests__/useSourceCatalog.test.tsx
git commit -m "feat(open-shelves): lazy-hydrate a seeded source on first open"
```

---

### Task 5: Curated badge + Restore action (UI)

**Files:**
- Modify: `mobile/src/openshelves/SourceRow.tsx`
- Modify: `mobile/app/(tabs)/shelves.tsx` (add a "Restore starter sources" control)
- Test: `mobile/src/openshelves/__tests__/SourceRow.test.tsx` (existing) + `mobile/__tests__/app/shelves.test.tsx` (existing)

**Interfaces:**
- Consumes: `FeedSource.isStarter`; `restoreStarterSources` (Task 2).
- Produces: no new export.

- [ ] **Step 1: Write the failing SourceRow test**

Add to `mobile/src/openshelves/__tests__/SourceRow.test.tsx`:

```tsx
it("shows a Curated by Mentible badge for a starter source", () => {
  const src = { id: "s1", url: "https://x", title: "Gutenberg", addedAt: "t", lastRefreshedAt: null, isStarter: true, entryCount: 0 };
  const { getByText } = render(<SourceRow source={src} onRefresh={() => {}} onRemove={() => {}} />);
  expect(getByText(/curated by mentible/i)).toBeTruthy();
});

it("shows no badge for a user-added source", () => {
  const src = { id: "s2", url: "https://x", title: "Mine", addedAt: "t", lastRefreshedAt: null, isStarter: false, entryCount: 0 };
  const { queryByText } = render(<SourceRow source={src} onRefresh={() => {}} onRemove={() => {}} />);
  expect(queryByText(/curated by mentible/i)).toBeNull();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/openshelves/__tests__/SourceRow.test.tsx`
Expected: FAIL — badge text not found.

- [ ] **Step 3: Add the badge to `SourceRow.tsx`**

Destructure `isStarter` and render the badge under the title:

```tsx
  const { id, title, url, entryCount, lastRefreshedAt, isStarter } = source;
  // ...inside <Pressable style={styles.meta}> after the title <Text>:
        {isStarter ? <Text style={styles.badge}>Curated by Mentible</Text> : null}
```

Add to `styles`:

```tsx
  badge: { color: colors.primary, fontSize: typography.sizeXs, fontWeight: "600" },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/openshelves/__tests__/SourceRow.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write the failing Restore-action test**

Add to `mobile/__tests__/app/shelves.test.tsx` (follow the file's existing render/store-mock setup). The control calls `restoreStarterSources`; assert tapping it invokes the restore path and the list reloads. Example (adapt to the file's existing helpers):

```tsx
it("restore starter sources re-adds removed shelves", async () => {
  // Arrange: seed then remove one starter shelf via the store, render Shelves.
  // Act: press the "Restore starter sources" control.
  // Assert: the removed shelf reappears in the list.
  const { getByText, findByText } = renderShelves();
  fireEvent.press(getByText(/restore starter sources/i));
  expect(await findByText("Project Gutenberg — Popular")).toBeTruthy();
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx jest __tests__/app/shelves.test.tsx -t "restore starter"`
Expected: FAIL — control not present.

- [ ] **Step 7: Add the Restore control to `shelves.tsx`**

Import `restoreStarterSources` from `@/openshelves/seedStarterSources`, add a Pressable "Restore starter sources" that calls it then reloads the sources list (reuse the screen's existing reload/refresh handler used after add/remove). Place it near the Sources-list header.

- [ ] **Step 8: Run to verify pass + full openshelves suite**

Run: `npx jest src/openshelves __tests__/app/shelves.test.tsx`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/openshelves/SourceRow.tsx "mobile/app/(tabs)/shelves.tsx" mobile/src/openshelves/__tests__/SourceRow.test.tsx mobile/__tests__/app/shelves.test.tsx
git commit -m "feat(open-shelves): Curated badge + Restore starter sources action"
```

---

### Task 6: Descriptive User-Agent on both feed-fetch paths

**Files:**
- Modify: `mobile/src/openshelves/fetchFeed.ts:49-53` (native fetch)
- Modify: `backend/src/shelves/feed_fetch.py:71-77` (backend proxy headers)
- Test: `mobile/src/openshelves/__tests__/fetchFeed.test.ts` (existing) + `backend/tests/test_shelves_feed_fetch.py` (existing)

**Interfaces:**
- Produces: `FEED_USER_AGENT` string constant in each module (not cross-imported — one per side).

- [ ] **Step 1: Write the failing native test**

Add to `mobile/src/openshelves/__tests__/fetchFeed.test.ts`:

```ts
it("sends a descriptive User-Agent on the feed request", async () => {
  const fetchImpl = jest.fn().mockResolvedValue({
    ok: true, status: 200, headers: { get: () => null }, text: async () => "<feed/>",
  } as unknown as Response);
  await fetchFeed("https://www.gutenberg.org/ebooks.opds/", fetchImpl);
  const [, init] = fetchImpl.mock.calls[0];
  expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/Mentible/);
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx jest src/openshelves/__tests__/fetchFeed.test.ts -t "User-Agent"`
Expected: FAIL — no headers passed.

- [ ] **Step 3: Add the UA in `fetchFeed.ts`**

Add the constant near `MAX_FEED_BYTES` and pass it in the fetch init:

```ts
export const FEED_USER_AGENT = "Mentible (+https://mambakkam.net/mentible)";
// ...in fetchFeed():
    resp = await fetchImpl(feedRequestUrl(clean), {
      method: "GET",
      headers: { "User-Agent": FEED_USER_AGENT },
    });
```

(On web the request targets our own backend and browsers drop the forbidden `User-Agent` header — harmless; the meaningful UA reaches Gutenberg from the backend, next step.)

- [ ] **Step 4: Run to verify pass**

Run: `npx jest src/openshelves/__tests__/fetchFeed.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing backend test**

Add to `backend/tests/test_shelves_feed_fetch.py` (reuse the file's `httpx.MockTransport` pattern; capture the request):

```python
async def test_fetch_feed_sends_user_agent():
    seen = {}
    def handler(request: httpx.Request) -> httpx.Response:
        seen["ua"] = request.headers.get("user-agent", "")
        return httpx.Response(200, headers={"content-type": "application/atom+xml"}, content=b"<feed/>")
    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    await fetch_feed("https://example.org/f.opds", client, resolve=lambda h: ["93.184.216.34"])
    assert "Mentible" in seen["ua"]
```

- [ ] **Step 6: Run to verify failure**

Run: `.venv/bin/python -m pytest backend/tests/test_shelves_feed_fetch.py -k user_agent`
Expected: FAIL — UA header absent (or default httpx UA, no "Mentible").

- [ ] **Step 7: Add the UA in `feed_fetch.py`**

Add a module constant and include it in the request headers (alongside `accept`):

```python
FEED_USER_AGENT = "Mentible (+https://mambakkam.net/mentible)"
# ...in build_request headers:
            headers={
                "accept": "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8",
                "user-agent": FEED_USER_AGENT,
            },
```

(A User-Agent is not a credential — this does not violate the no-auth guardrail; the `authorization`/`cookie` strips below are unchanged.)

- [ ] **Step 8: Run to verify pass**

Run: `.venv/bin/python -m pytest backend/tests/test_shelves_feed_fetch.py`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add mobile/src/openshelves/fetchFeed.ts mobile/src/openshelves/__tests__/fetchFeed.test.ts backend/src/shelves/feed_fetch.py backend/tests/test_shelves_feed_fetch.py
git commit -m "feat(open-shelves): descriptive User-Agent on feed fetches (native + proxy)"
```

---

### Final: full-suite gate

- [ ] **Step 1: Mobile**

Run (from `mobile/`): `npx tsc --noEmit && npx eslint . && npx jest`
Expected: tsc clean, eslint 0 errors, all tests pass (incl. `starter-claim`, `coverage`).

- [ ] **Step 2: Backend**

Run (from repo root): `.venv/bin/python -m pytest backend/tests -q`
Expected: all pass.

- [ ] **Step 3: Manual feed re-verify (not CI)**

Confirm each starter URL is still live + drills to an EPUB before shipping:
`curl -sL -A "Mentible (+https://mambakkam.net/mentible)" "https://www.gutenberg.org/ebooks/search.opds/?query=science" | grep -c '<entry>'` (expect > 0).
