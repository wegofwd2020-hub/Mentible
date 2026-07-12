# Open Shelves — Store Persistence (ADR-028, plan 2 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the Open Shelves catalog on-device and wire the plan-1 feed engine into a refreshable store: source records + per-source entries in AsyncStorage, `addSource`/`removeSource`, and an idempotent `refreshSource`/`refreshAll` that composes `fetchFeed → parseOpds12 → reconcileEntries` with the **keep-previous-catalog-on-failure** rule (spec P0-1, P0-4).

**Architecture:** Two thin AsyncStorage layers in `mobile/src/openshelves/` — `feedSourcesStore` (a single small JSON blob: the list of `FeedSource`) and `feedEntriesStore` (one blob per source, `sbq_feed_entries_<id>`, bounded by the parser's `MAX_ENTRIES`). Orchestration functions (`addSource`, `refreshSource`, `refreshAll`, `removeSource`) live in `feedStore.ts` and thread an injectable `fetchImpl` down to `fetchFeed` so tests never touch the network. This matches the house store pattern (`shelfStore.ts`/`bookStore.ts`) and adds no native dependency, so the localhost branch needs no rebuild. If real feeds outgrow AsyncStorage's per-key budget, migrate the entries layer to `expo-sqlite` (documented escape hatch, same as `bookStore.ts`).

**Tech Stack:** TypeScript, `@react-native-async-storage/async-storage` (installed), jest-expo (auto-mocks AsyncStorage). Branch: `feat/open-shelves` (localhost-only; never deployed).

## Global Constraints

- **Location:** `mobile/src/openshelves/`; tests in `mobile/src/openshelves/__tests__/`. Commands run from `mobile/`.
- **Storage keys:** sources → `"sbq_feed_sources"` (one JSON blob = `FeedSource[]`); entries → `"sbq_feed_entries_" + sourceId` (one JSON blob = `FeedEntry[]` per source).
- **No content payloads** — only metadata (`FeedEntry`), consistent with plan 1 / spec P0-3.
- **Refresh is idempotent + safe (spec P0-4):** `refreshSource` fetches → parses → `reconcileEntries(prev, incoming)` → persists `merged`, then updates `lastRefreshedAt`/`entryCount`. **On any fetch/parse error the stored catalog is left untouched** (the error propagates; no partial write).
- **No live network in tests:** every orchestration function takes an optional `fetchImpl: typeof fetch` threaded to `fetchFeed`; tests inject a fake returning canned OPDS XML. Reads/writes go through the AsyncStorage jest mock (`AsyncStorage.clear()` in `beforeEach`).
- **Reuse plan-1 engine unchanged:** import `fetchFeed`, `parseOpds12`, `reconcileEntries`, `validateFeedUrl`, the `FeedEntry`/`FeedSource` types, and the typed errors. Do **not** re-implement parsing/fetching/reconcile.
- **`removeSource` purges** the source record **and** its entries blob (spec P0-1: removal leaves no entries behind).
- **Corruption tolerance:** a malformed/absent stored blob reads back as the empty default (`[]`), never throws — mirror `shelfStore`'s `try/catch → []`.

---

### Task 1: Per-source entries store

**Files:**
- Create: `mobile/src/openshelves/feedEntriesStore.ts`
- Test: `mobile/src/openshelves/__tests__/feedEntriesStore.test.ts`

**Interfaces:**
- Consumes: `FeedEntry` from `./types`.
- Produces:
  - `getEntries(sourceId: string): Promise<FeedEntry[]>` — the stored entries for a source, `[]` if none/corrupt.
  - `putEntries(sourceId: string, entries: FeedEntry[]): Promise<void>` — overwrite the source's entries blob.
  - `deleteEntries(sourceId: string): Promise<void>` — remove the source's entries blob.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/feedEntriesStore.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getEntries, putEntries, deleteEntries } from "../feedEntriesStore";
import type { FeedEntry } from "../types";

const mk = (id: string): FeedEntry => ({
  id, title: "t", authors: [], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null,
});

beforeEach(async () => { await AsyncStorage.clear(); });

test("round-trips entries per source", async () => {
  await putEntries("s1", [mk("a"), mk("b")]);
  expect((await getEntries("s1")).map((e) => e.id)).toEqual(["a", "b"]);
  expect(await getEntries("s2")).toEqual([]); // untouched source
});

test("delete removes only that source's entries", async () => {
  await putEntries("s1", [mk("a")]);
  await putEntries("s2", [mk("b")]);
  await deleteEntries("s1");
  expect(await getEntries("s1")).toEqual([]);
  expect((await getEntries("s2")).map((e) => e.id)).toEqual(["b"]);
});

test("corrupt blob reads back as empty, never throws", async () => {
  await AsyncStorage.setItem("sbq_feed_entries_s1", "{not json");
  expect(await getEntries("s1")).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedEntriesStore.test.ts`
Expected: FAIL — cannot find module `../feedEntriesStore`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/feedEntriesStore.ts
// Per-source catalog entries (spec P0-3). One AsyncStorage blob per source, keyed
// by source id, so a single source's payload is bounded by the parser's
// MAX_ENTRIES. Metadata only — no content bytes. Migrate to expo-sqlite if real
// feeds outgrow AsyncStorage's per-key budget (same stance as bookStore.ts).
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FeedEntry } from "./types";

const entriesKey = (sourceId: string) => `sbq_feed_entries_${sourceId}`;

export async function getEntries(sourceId: string): Promise<FeedEntry[]> {
  const raw = await AsyncStorage.getItem(entriesKey(sourceId));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedEntry[]) : [];
  } catch {
    return [];
  }
}

export async function putEntries(sourceId: string, entries: FeedEntry[]): Promise<void> {
  await AsyncStorage.setItem(entriesKey(sourceId), JSON.stringify(entries));
}

export async function deleteEntries(sourceId: string): Promise<void> {
  await AsyncStorage.removeItem(entriesKey(sourceId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedEntriesStore.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/feedEntriesStore.ts mobile/src/openshelves/__tests__/feedEntriesStore.test.ts
git commit -m "feat(open-shelves): per-source entries store (AsyncStorage)"
```

---

### Task 2: Source-list store + entryCount on FeedSource

**Files:**
- Modify: `mobile/src/openshelves/types.ts` (add `entryCount: number` to `FeedSource`)
- Create: `mobile/src/openshelves/feedSourcesStore.ts`
- Test: `mobile/src/openshelves/__tests__/feedSourcesStore.test.ts`

**Interfaces:**
- Consumes: `FeedSource` from `./types`.
- Produces:
  - (types.ts) `FeedSource` gains `entryCount: number` — the cached count shown in the Sources list (spec P0-1), kept in sync by `addSource`/`refreshSource`.
  - `listSources(): Promise<FeedSource[]>` — all sources, `[]` if none/corrupt.
  - `getSource(id: string): Promise<FeedSource | null>`.
  - `putSource(source: FeedSource): Promise<void>` — upsert by `id` (replace if present, else append).
  - `deleteSourceRecord(id: string): Promise<void>` — remove just the source record (entries are purged separately by `removeSource`, Task 4).

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/feedSourcesStore.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { listSources, getSource, putSource, deleteSourceRecord } from "../feedSourcesStore";
import type { FeedSource } from "../types";

const mk = (id: string, over: Partial<FeedSource> = {}): FeedSource => ({
  id, url: `https://ex.org/${id}`, title: null, addedAt: "2026-07-12T00:00:00Z",
  lastRefreshedAt: null, isStarter: false, entryCount: 0, ...over,
});

beforeEach(async () => { await AsyncStorage.clear(); });

test("upsert appends new and replaces existing by id", async () => {
  await putSource(mk("a", { entryCount: 2 }));
  await putSource(mk("b"));
  await putSource(mk("a", { entryCount: 9 })); // replace, not duplicate
  const all = await listSources();
  expect(all.map((s) => s.id)).toEqual(["a", "b"]);
  expect((await getSource("a"))?.entryCount).toBe(9);
  expect(await getSource("missing")).toBeNull();
});

test("deleteSourceRecord removes only that record", async () => {
  await putSource(mk("a"));
  await putSource(mk("b"));
  await deleteSourceRecord("a");
  expect((await listSources()).map((s) => s.id)).toEqual(["b"]);
});

test("corrupt blob reads back as empty", async () => {
  await AsyncStorage.setItem("sbq_feed_sources", "nope");
  expect(await listSources()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedSourcesStore.test.ts`
Expected: FAIL — cannot find module `../feedSourcesStore` (and a type error on `entryCount` until types.ts is updated).

- [ ] **Step 3: Write the implementation**

First add `entryCount` to `FeedSource` in `mobile/src/openshelves/types.ts` (the interface currently ends with `isStarter: boolean;`):

```typescript
export interface FeedSource {
  id: string; // local uuid
  url: string; // https feed URL
  title: string | null; // feed title from parse
  addedAt: string; // ISO 8601
  lastRefreshedAt: string | null;
  isStarter: boolean; // from the owner-curated starter list (spec P0-5)
  entryCount: number; // cached count for the Sources list (spec P0-1)
}
```

Then create the store:

```typescript
// mobile/src/openshelves/feedSourcesStore.ts
// The list of subscribed feed sources (spec P0-1). A single small JSON blob —
// labels + counts + timestamps, no entry payloads (those live in
// feedEntriesStore). Mirrors the shelfStore local-first pattern.
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { FeedSource } from "./types";

const SOURCES_KEY = "sbq_feed_sources";

export async function listSources(): Promise<FeedSource[]> {
  const raw = await AsyncStorage.getItem(SOURCES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FeedSource[]) : [];
  } catch {
    return [];
  }
}

export async function getSource(id: string): Promise<FeedSource | null> {
  return (await listSources()).find((s) => s.id === id) ?? null;
}

export async function putSource(source: FeedSource): Promise<void> {
  const all = await listSources();
  const idx = all.findIndex((s) => s.id === source.id);
  if (idx >= 0) all[idx] = source;
  else all.push(source);
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(all));
}

export async function deleteSourceRecord(id: string): Promise<void> {
  const all = await listSources();
  await AsyncStorage.setItem(SOURCES_KEY, JSON.stringify(all.filter((s) => s.id !== id)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedSourcesStore.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Verify plan-1 suites still pass (FeedSource type changed)**

Run: `cd mobile && npx jest src/openshelves && npx tsc --noEmit -p tsconfig.json`
Expected: all openshelves suites pass; no new tsc errors. (Plan-1 code never constructs a bare `FeedSource`, so the added required field shouldn't break it — if a test helper does, it lives in this plan's files.)

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/types.ts mobile/src/openshelves/feedSourcesStore.ts mobile/src/openshelves/__tests__/feedSourcesStore.test.ts
git commit -m "feat(open-shelves): source-list store + entryCount on FeedSource"
```

---

### Task 3: addSource — compose validate → fetch → parse → persist

**Files:**
- Create: `mobile/src/openshelves/feedStore.ts`
- Test: `mobile/src/openshelves/__tests__/feedStore.addSource.test.ts`

**Interfaces:**
- Consumes: `validateFeedUrl`, `fetchFeed` from `./fetchFeed`; `parseOpds12` from `./opds12`; `putEntries` from `./feedEntriesStore`; `putSource`, `listSources` from `./feedSourcesStore`; `FeedSource` from `./types`; `randomUUID` from `@/lib/uuid`; timestamp via `new Date().toISOString()`.
- Produces:
  - `addSource(url: string, opts?: { fetchImpl?: typeof fetch; now?: () => string; newId?: () => string }): Promise<FeedSource>` — validates the URL, fetches + parses the feed, persists its entries and a new source record (`isStarter: false`, `entryCount` = parsed entry count, `title` = the feed's title, `lastRefreshedAt` = now). Throws on a bad URL / unreachable / unparseable feed **without persisting anything**. `opts.now`/`opts.newId` are injectable for deterministic tests (default to `Date`/`randomUUID`).

**Notes for the implementer:**
- Order matters for the "nothing persisted on error" guarantee: `validateFeedUrl` → `fetchFeed` → `parseOpds12` all run (and may throw) **before** any `putEntries`/`putSource`. Only after a successful parse do you write.
- `randomUUID` comes from `@/lib/uuid` (Hermes has no global crypto — see the repo's uuid shim). Use `opts.newId ?? randomUUID` and `opts.now ?? (() => new Date().toISOString())`.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/feedStore.addSource.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addSource } from "../feedStore";
import { listSources } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { FeedSourceError } from "../errors";

const OPDS = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Lib</title>
  <entry><id>e1</id><title>Book One</title>
    <link rel="http://opds-spec.org/acquisition" href="https://ex.org/1.epub" type="application/epub+zip"/>
  </entry>
  <entry><id>e2</id><title>Book Two</title></entry>
</feed>`;

const ok = async () =>
  ({ ok: true, status: 200, headers: { get: () => null }, text: async () => OPDS } as unknown as Response);

const fixedOpts = { fetchImpl: ok as any, now: () => "2026-07-12T00:00:00Z", newId: () => "src-1" };

beforeEach(async () => { await AsyncStorage.clear(); });

test("adds a source and persists its entries", async () => {
  const src = await addSource("https://ex.org/feed", fixedOpts);
  expect(src).toMatchObject({ id: "src-1", url: "https://ex.org/feed", title: "Lib", isStarter: false, entryCount: 2, lastRefreshedAt: "2026-07-12T00:00:00Z" });
  expect((await listSources()).map((s) => s.id)).toEqual(["src-1"]);
  expect((await getEntries("src-1")).map((e) => e.id)).toEqual(["e1", "e2"]);
});

test("a non-https URL throws and persists nothing", async () => {
  await expect(addSource("http://ex.org/feed", fixedOpts)).rejects.toBeInstanceOf(FeedSourceError);
  expect(await listSources()).toEqual([]);
  expect(await getEntries("src-1")).toEqual([]);
});

test("an unreachable feed throws and persists nothing", async () => {
  const boom = async () => { throw new Error("network down"); };
  await expect(addSource("https://ex.org/feed", { ...fixedOpts, fetchImpl: boom as any })).rejects.toBeInstanceOf(FeedSourceError);
  expect(await listSources()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedStore.addSource.test.ts`
Expected: FAIL — cannot find module `../feedStore`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/feedStore.ts
// Orchestration: composes the plan-1 engine (validate → fetch → parse → reconcile)
// with the persistence layers into add/refresh/remove operations. Network is
// injectable (opts.fetchImpl) so tests never hit the wire.
import { randomUUID } from "@/lib/uuid";
import type { FeedSource } from "./types";
import { validateFeedUrl, fetchFeed } from "./fetchFeed";
import { parseOpds12 } from "./opds12";
import { putEntries } from "./feedEntriesStore";
import { putSource } from "./feedSourcesStore";

export interface AddSourceOpts {
  fetchImpl?: typeof fetch;
  now?: () => string;
  newId?: () => string;
}

export async function addSource(url: string, opts: AddSourceOpts = {}): Promise<FeedSource> {
  const now = opts.now ?? (() => new Date().toISOString());
  const newId = opts.newId ?? randomUUID;

  // Validate + fetch + parse FIRST — all may throw. Nothing is persisted until
  // we have a good parse (spec P0-1: a bad add leaves the catalog untouched).
  const clean = validateFeedUrl(url);
  const xml = await fetchFeed(clean, opts.fetchImpl ?? fetch);
  const { feedTitle, entries } = parseOpds12(xml);

  const id = newId();
  const source: FeedSource = {
    id,
    url: clean,
    title: feedTitle,
    addedAt: now(),
    lastRefreshedAt: now(),
    isStarter: false,
    entryCount: entries.length,
  };
  await putEntries(id, entries);
  await putSource(source);
  return source;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedStore.addSource.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/feedStore.ts mobile/src/openshelves/__tests__/feedStore.addSource.test.ts
git commit -m "feat(open-shelves): addSource — compose engine + persist (nothing on error)"
```

---

### Task 4: refreshSource / refreshAll / removeSource

**Files:**
- Modify: `mobile/src/openshelves/feedStore.ts` (add `refreshSource`, `refreshAll`, `removeSource`)
- Test: `mobile/src/openshelves/__tests__/feedStore.refresh.test.ts`

**Interfaces:**
- Consumes (additional): `fetchFeed`, `parseOpds12`, `reconcileEntries` from `./reconcile`; `getEntries`, `putEntries`, `deleteEntries` from `./feedEntriesStore`; `getSource`, `putSource`, `listSources`, `deleteSourceRecord` from `./feedSourcesStore`.
- Produces:
  - `refreshSource(id: string, opts?: { fetchImpl?: typeof fetch; now?: () => string }): Promise<{ added: number; updated: number; removed: number }>` — fetch+parse the source's URL, `reconcileEntries(prev, incoming)`, persist `merged`, update the source's `lastRefreshedAt`/`entryCount`. **On fetch/parse error: throw and leave the stored entries + source record untouched** (spec P0-4). Throws `FeedRefreshError` if `id` is unknown.
  - `refreshAll(opts?): Promise<Record<string, { added: number; updated: number; removed: number } | { error: string }>>` — refresh every source; a failing source records `{ error }` and does **not** abort the others.
  - `removeSource(id: string): Promise<void>` — delete the source record **and** its entries blob (spec P0-1).

**Notes for the implementer:**
- The keep-prev guarantee is structural: do `const xml = await fetchFeed(...)` and `const { entries } = parseOpds12(xml)` **before** touching the store. If either throws, you return/propagate without having written. Only after a good parse do you `reconcileEntries` + `putEntries` + `putSource`.
- Import `FeedRefreshError` from `./errors`.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/feedStore.refresh.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { addSource, refreshSource, refreshAll, removeSource } from "../feedStore";
import { listSources, getSource } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { FeedRefreshError } from "../errors";

const feed = (entries: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom"><title>Lib</title>${entries}</feed>`;
const e = (id: string) => `<entry><id>${id}</id><title>t</title></entry>`;
const resp = (xml: string) => async () =>
  ({ ok: true, status: 200, headers: { get: () => null }, text: async () => xml } as unknown as Response);

const addOpts = (xml: string) => ({ fetchImpl: resp(xml) as any, now: () => "T0", newId: () => "s1" });

beforeEach(async () => { await AsyncStorage.clear(); });

test("refresh upserts new and prunes removed, updates count + timestamp", async () => {
  await addSource("https://ex.org/f", addOpts(feed(e("a") + e("b"))));
  const r = await refreshSource("s1", { fetchImpl: resp(feed(e("a") + e("c"))) as any, now: () => "T1" });
  expect(r).toEqual({ added: 1, updated: 0, removed: 1 }); // +c, -b
  expect((await getEntries("s1")).map((x) => x.id)).toEqual(["a", "c"]);
  const s = await getSource("s1");
  expect(s?.entryCount).toBe(2);
  expect(s?.lastRefreshedAt).toBe("T1");
});

test("a failed refresh leaves the previous catalog intact (P0-4)", async () => {
  await addSource("https://ex.org/f", addOpts(feed(e("a") + e("b"))));
  const boom = async () => { throw new Error("network down"); };
  await expect(refreshSource("s1", { fetchImpl: boom as any })).rejects.toThrow();
  expect((await getEntries("s1")).map((x) => x.id)).toEqual(["a", "b"]); // unchanged
  expect((await getSource("s1"))?.lastRefreshedAt).toBe("T0"); // unchanged
});

test("refreshSource on unknown id throws FeedRefreshError", async () => {
  await expect(refreshSource("nope")).rejects.toBeInstanceOf(FeedRefreshError);
});

test("removeSource deletes the record and its entries", async () => {
  await addSource("https://ex.org/f", addOpts(feed(e("a"))));
  await removeSource("s1");
  expect(await listSources()).toEqual([]);
  expect(await getEntries("s1")).toEqual([]);
});

test("refreshAll refreshes each source and isolates failures", async () => {
  await addSource("https://ex.org/f1", { fetchImpl: resp(feed(e("a"))) as any, now: () => "T0", newId: () => "s1" });
  await addSource("https://ex.org/f2", { fetchImpl: resp(feed(e("b"))) as any, now: () => "T0", newId: () => "s2" });
  const boom = async (u: string) => (String(u).includes("f2") ? (() => { throw new Error("x"); })() : resp(feed(e("a") + e("z")))(u));
  const out = await refreshAll({ fetchImpl: boom as any, now: () => "T1" });
  expect(out["s1"]).toEqual({ added: 1, updated: 0, removed: 0 }); // +z
  expect("error" in (out["s2"] as any)).toBe(true); // f2 failed, isolated
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedStore.refresh.test.ts`
Expected: FAIL — `refreshSource`/`refreshAll`/`removeSource` are not exported.

- [ ] **Step 3: Write the implementation**

Append to `mobile/src/openshelves/feedStore.ts` (add the imports at the top alongside the existing ones):

```typescript
// add to the imports block:
import { reconcileEntries } from "./reconcile";
import { getEntries, deleteEntries } from "./feedEntriesStore";
import { getSource, listSources, deleteSourceRecord } from "./feedSourcesStore";
import { FeedRefreshError } from "./errors";

export interface RefreshOpts {
  fetchImpl?: typeof fetch;
  now?: () => string;
}

type RefreshCounts = { added: number; updated: number; removed: number };

export async function refreshSource(id: string, opts: RefreshOpts = {}): Promise<RefreshCounts> {
  const source = await getSource(id);
  if (!source) throw new FeedRefreshError(`unknown source: ${id}`);
  const now = opts.now ?? (() => new Date().toISOString());

  // Fetch + parse BEFORE touching the store — if either throws, the stored
  // catalog is left exactly as it was (spec P0-4 partial-failure safety).
  const xml = await fetchFeed(source.url, opts.fetchImpl ?? fetch);
  const { entries: incoming } = parseOpds12(xml);

  const prev = await getEntries(id);
  const { merged, added, updated, removed } = reconcileEntries(prev, incoming);
  await putEntries(id, merged);
  await putSource({ ...source, lastRefreshedAt: now(), entryCount: merged.length });
  return { added, updated, removed };
}

export async function refreshAll(
  opts: RefreshOpts = {},
): Promise<Record<string, RefreshCounts | { error: string }>> {
  const out: Record<string, RefreshCounts | { error: string }> = {};
  for (const s of await listSources()) {
    try {
      out[s.id] = await refreshSource(s.id, opts);
    } catch (err) {
      out[s.id] = { error: (err as Error).message };
    }
  }
  return out;
}

export async function removeSource(id: string): Promise<void> {
  await deleteSourceRecord(id);
  await deleteEntries(id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/feedStore.refresh.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Whole-module suite + typecheck**

Run: `cd mobile && npx jest src/openshelves && npx tsc --noEmit -p tsconfig.json`
Expected: all openshelves suites pass; no new tsc errors.

- [ ] **Step 6: Commit**

```bash
git add mobile/src/openshelves/feedStore.ts mobile/src/openshelves/__tests__/feedStore.refresh.test.ts
git commit -m "feat(open-shelves): refreshSource/refreshAll/removeSource (idempotent, keep-prev-on-failure)"
```

---

## What this plan leaves to later plans

- **Sources management UI** (P0-1) — add/list/remove screens with the add-time warning (P0-8) + no-auth message (P0-9), calling `addSource`/`removeSource`/`refreshSource`.
- **Starter list** (P0-5) — seed three owner-curated sources via remote config (`isStarter: true`); D3a live-feed verification.
- **Refresh UI** (P0-4) — per-source + refresh-all buttons, `lastRefreshedAt` display, the `refreshAll` result surfaced (note the reconcile array-reorder false-`updated` caveat before showing an "N updated" count).
- **Browse + provenance** (P0-7) — entry list/detail from `getEntries`; web HTML rendering reuses `sanitizeFragment`.
- **Downloads** (P0-6/P0-10) — re-validate `link.href` (SSRF note from plan 1) before fetching.
- **Language filter F-1** — pure `(prefs × entry) → boolean` over the stored `FeedEntry` fields.

## Self-Review

**Spec coverage (this slice):** P0-1 add/list/remove + entry count + removal purges entries → Tasks 2/3/4; P0-3 metadata-only persistence → Tasks 1/2; P0-4 idempotent refresh + keep-prev-on-failure → Task 4 (composes plan-1 `reconcileEntries`). UI/starter-list/browse/downloads/filters explicitly deferred.

**Placeholder scan:** none — every step has real code + commands.

**Type consistency:** `FeedEntry`/`FeedSource` come from plan-1 `types.ts` (Task 2 adds the `entryCount` field, used consistently by `addSource`/`refreshSource`/the sources store); `getEntries`/`putEntries`/`deleteEntries` (Task 1), `listSources`/`getSource`/`putSource`/`deleteSourceRecord` (Task 2), and `addSource`/`refreshSource`/`refreshAll`/`removeSource` (Tasks 3/4) signatures match between their producing task and every consumer; the injected `fetchImpl`/`now`/`newId` seams are identical across Tasks 3 and 4.
