# Open Shelves — Downloads & Offline (ADR-028, plan 5 of N) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a reader download an entry's EPUB/PDF/audio to their device for offline use (spec P0-6/P0-10): a pure URL-resolution + link-selection layer, a device-local downloads manifest, a download engine behind an injectable file-system seam (progress, cancel, integrity-quarantine of partials), a `useDownloads` hook + a Downloads view (per-item size, total, per-item + bulk delete), and a Download button wired into the entry detail. **Video is never downloadable** (streaming-only, spec §2). Downloads are device-local, per-device, never synced.

**Architecture:** Mirrors the house `epubLibrary.ts` pattern (`Platform.OS==="web"` split; native `expo-file-system` under `documentDirectory/openshelves-downloads/`; web falls back to a browser download and is **not** tracked as an in-app offline item — accepted platform asymmetry, spec §7). All device I/O sits behind an injectable `Downloader`/`fs` seam so the engine is unit-tested with mocks — **the real `FileSystem.downloadAsync`/web-download behavior is NOT unit-verifiable and requires on-device + on-web manual verification** (Task 6). Pure pieces: `resolveUrl` (closes the plan-4 relative-URL gap), `pickDownloadLink`, the manifest store, and delete are fully TDD-tested. Downloads go **source → device directly** — Mentible infra never relays (spec §2).

**Tech Stack:** React Native + `expo-file-system` (~18.1) + `expo-sharing`, expo-router, `@testing-library/react-native`, jest-expo. Branch: `feat/open-shelves` (localhost-only; never deployed).

## Global Constraints

- **Location:** logic in `mobile/src/openshelves/`; the Downloads screen at `mobile/app/shelves/downloads.tsx`; register in `mobile/app/_layout.tsx`. Tests co-located. Commands run from `mobile/`.
- **Video is never downloaded** (spec §2): `pickDownloadLink` returns null for a video-only entry; the Download button is hidden for `mediaType === "video"`.
- **URL safety (carries plan-1 hardening forward):** only download from an http/https URL. `resolveUrl(baseFeedUrl, href)` resolves a **relative** acquisition href against the source feed URL, then the result must still be http/https (reject otherwise) — never fetch a `javascript:`/`data:`/`file:` or a resolved non-http URL. Re-validate at download time, not just at parse time.
- **Integrity (spec §7 / P0-10):** a download is marked offline-available **only after** it completes and its on-disk size is > 0 (and matches the server's content-length when provided). A partial/failed/canceled download leaves **no** manifest entry and no half-file (quarantine: write to a `.part` path, verify, then move/record; delete the `.part` on failure).
- **Device-local, per-device (spec §2):** the manifest + files live only on this device; nothing is uploaded, synced, or attributed to the account. A download exists only where it was performed.
- **Injectable I/O seam:** the engine takes a `Downloader` (native/web impl) so tests never touch the real filesystem/network. Do **not** call `FileSystem.*`/`fetch` directly inside the tested engine function — call the injected seam.
- **No content on Mentible infra:** downloads are source→device. Never proxy/relay through any backend.
- **Manual verification required (Task 6):** the actual native FS write + web browser-download are not unit-testable; Task 6 is an on-device/on-web checklist, not code.

---

### Task 1: URL resolution + downloadable-link selection (pure)

**Files:**
- Create: `mobile/src/openshelves/downloadTarget.ts`
- Test: `mobile/src/openshelves/__tests__/downloadTarget.test.ts`

**Interfaces:**
- Consumes: `FeedEntry`, `AcquisitionLink`, `MediaType` from `./types`.
- Produces:
  - `resolveUrl(baseFeedUrl: string, href: string): string | null` — returns an absolute **http/https** URL, resolving a relative `href` against `baseFeedUrl`; returns `null` for an empty href or any result whose scheme isn't http/https.
  - `pickDownloadLink(entry: FeedEntry, baseFeedUrl: string): { url: string; mimeType: string } | null` — chooses the best downloadable acquisition link: prefer EPUB (`application/epub+zip`), then PDF (`application/pdf`), then audio (`audio/*`); **never** a video link; resolves its href via `resolveUrl`. Returns null when nothing downloadable resolves (incl. `mediaType === "video"` entries with no book/audio link).

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/downloadTarget.test.ts
import { resolveUrl, pickDownloadLink } from "../downloadTarget";
import type { FeedEntry, AcquisitionLink } from "../types";

const BASE = "https://ex.org/catalog/index.atom";
const link = (href: string, mimeType: string, rel = "http://opds-spec.org/acquisition"): AcquisitionLink => ({ href, mimeType, rel });
const entry = (links: AcquisitionLink[], mediaType: FeedEntry["mediaType"] = "book"): FeedEntry => ({
  id: "e1", title: "t", authors: [], summary: "", coverUrl: null, language: null, categories: [],
  mediaType, rightsText: null, mature: null, links, canonicalUrl: null,
});

test("resolveUrl keeps absolute https, resolves relative against the feed, rejects non-http", () => {
  expect(resolveUrl(BASE, "https://cdn.org/a.epub")).toBe("https://cdn.org/a.epub");
  expect(resolveUrl(BASE, "/files/a.epub")).toBe("https://ex.org/files/a.epub");
  expect(resolveUrl(BASE, "../b.pdf")).toBe("https://ex.org/b.pdf");
  expect(resolveUrl(BASE, "javascript:alert(1)")).toBeNull();
  expect(resolveUrl(BASE, "")).toBeNull();
});

test("pickDownloadLink prefers epub, then pdf, then audio; never video", () => {
  const e = entry([link("/a.pdf", "application/pdf"), link("/a.epub", "application/epub+zip")]);
  expect(pickDownloadLink(e, BASE)).toEqual({ url: "https://ex.org/a.epub", mimeType: "application/epub+zip" });

  const audio = entry([link("/a.mp3", "audio/mpeg")], "audio");
  expect(pickDownloadLink(audio, BASE)).toEqual({ url: "https://ex.org/a.mp3", mimeType: "audio/mpeg" });
});

test("a video-only entry has nothing downloadable", () => {
  const v = entry([link("https://ex.org/v.mp4", "video/mp4")], "video");
  expect(pickDownloadLink(v, BASE)).toBeNull();
});

test("an entry whose only link resolves to a bad scheme yields null", () => {
  const bad = entry([link("javascript:x", "application/epub+zip")]);
  expect(pickDownloadLink(bad, BASE)).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/downloadTarget.test.ts`
Expected: FAIL — cannot find module `../downloadTarget`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/downloadTarget.ts
// Pure: pick a downloadable acquisition link and resolve its URL to an absolute
// http/https address. Closes the plan-4 relative-URL gap and re-asserts the
// scheme allowlist at download-selection time. Video is never downloadable.
import type { AcquisitionLink, FeedEntry } from "./types";

export function resolveUrl(baseFeedUrl: string, href: string): string | null {
  const h = (href ?? "").trim();
  if (!h) return null;
  let abs: URL;
  try {
    abs = new URL(h, baseFeedUrl); // resolves relative against the feed URL
  } catch {
    return null;
  }
  if (abs.protocol !== "http:" && abs.protocol !== "https:") return null;
  return abs.toString();
}

// Preference order by MIME; video is intentionally excluded.
function rank(mime: string): number {
  const m = mime.toLowerCase();
  if (m === "application/epub+zip") return 0;
  if (m === "application/pdf") return 1;
  if (m.startsWith("audio/")) return 2;
  return 99;
}

export function pickDownloadLink(
  entry: FeedEntry,
  baseFeedUrl: string,
): { url: string; mimeType: string } | null {
  const candidates = entry.links
    .filter((l: AcquisitionLink) => rank(l.mimeType) < 99)
    .sort((a, b) => rank(a.mimeType) - rank(b.mimeType));
  for (const l of candidates) {
    const url = resolveUrl(baseFeedUrl, l.href);
    if (url) return { url, mimeType: l.mimeType };
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/downloadTarget.test.ts`
Expected: PASS — 4 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/downloadTarget.ts mobile/src/openshelves/__tests__/downloadTarget.test.ts
git commit -m "feat(open-shelves): pure download-link selection + relative-URL resolution"
```

---

### Task 2: Downloads manifest store

**Files:**
- Create: `mobile/src/openshelves/downloadsStore.ts`
- Test: `mobile/src/openshelves/__tests__/downloadsStore.test.ts`

**Interfaces:**
- Produces:
  - `interface DownloadRecord { entryId: string; sourceId: string; title: string; path: string; mimeType: string; bytes: number; downloadedAt: string }`
  - `listDownloads(): Promise<DownloadRecord[]>` — `[]` if none/corrupt.
  - `getDownload(entryId: string): Promise<DownloadRecord | null>`
  - `putDownload(rec: DownloadRecord): Promise<void>` — upsert by `entryId`.
  - `deleteDownloadRecord(entryId: string): Promise<void>`
  - `totalBytes(records: DownloadRecord[]): number` — pure sum helper.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/downloadsStore.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { listDownloads, getDownload, putDownload, deleteDownloadRecord, totalBytes, type DownloadRecord } from "../downloadsStore";

const rec = (entryId: string, bytes = 100): DownloadRecord => ({
  entryId, sourceId: "s1", title: entryId, path: `/x/${entryId}.epub`,
  mimeType: "application/epub+zip", bytes, downloadedAt: "T0",
});

beforeEach(async () => { await AsyncStorage.clear(); });

test("upsert by entryId, list, get, total", async () => {
  await putDownload(rec("a", 100));
  await putDownload(rec("b", 250));
  await putDownload(rec("a", 999)); // replace
  const all = await listDownloads();
  expect(all.map((d) => d.entryId)).toEqual(["a", "b"]);
  expect((await getDownload("a"))?.bytes).toBe(999);
  expect(totalBytes(all)).toBe(999 + 250);
  expect(await getDownload("missing")).toBeNull();
});

test("delete removes one record", async () => {
  await putDownload(rec("a"));
  await putDownload(rec("b"));
  await deleteDownloadRecord("a");
  expect((await listDownloads()).map((d) => d.entryId)).toEqual(["b"]);
});

test("corrupt blob → empty", async () => {
  await AsyncStorage.setItem("sbq_open_shelves_downloads", "nope");
  expect(await listDownloads()).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/downloadsStore.test.ts`
Expected: FAIL — cannot find module `../downloadsStore`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/downloadsStore.ts
// Device-local index of downloaded entries (spec P0-10). Metadata only — the
// bytes live on disk at `path`. Per-device, never synced. Mirrors the house
// AsyncStorage index pattern (feedSourcesStore / shelfStore).
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface DownloadRecord {
  entryId: string;
  sourceId: string;
  title: string;
  path: string;
  mimeType: string;
  bytes: number;
  downloadedAt: string;
}

const KEY = "sbq_open_shelves_downloads";

export async function listDownloads(): Promise<DownloadRecord[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DownloadRecord[]) : [];
  } catch {
    return [];
  }
}

export async function getDownload(entryId: string): Promise<DownloadRecord | null> {
  return (await listDownloads()).find((d) => d.entryId === entryId) ?? null;
}

export async function putDownload(rec: DownloadRecord): Promise<void> {
  const all = await listDownloads();
  const idx = all.findIndex((d) => d.entryId === rec.entryId);
  if (idx >= 0) all[idx] = rec;
  else all.push(rec);
  await AsyncStorage.setItem(KEY, JSON.stringify(all));
}

export async function deleteDownloadRecord(entryId: string): Promise<void> {
  const all = await listDownloads();
  await AsyncStorage.setItem(KEY, JSON.stringify(all.filter((d) => d.entryId !== entryId)));
}

export function totalBytes(records: DownloadRecord[]): number {
  return records.reduce((n, d) => n + (d.bytes || 0), 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/downloadsStore.test.ts`
Expected: PASS — 3 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/downloadsStore.ts mobile/src/openshelves/__tests__/downloadsStore.test.ts
git commit -m "feat(open-shelves): downloads manifest store (device-local index)"
```

---

### Task 3: Download engine (injectable I/O seam) + delete

**Files:**
- Create: `mobile/src/openshelves/downloadEngine.ts`
- Test: `mobile/src/openshelves/__tests__/downloadEngine.test.ts`

**Interfaces:**
- Consumes: `FeedEntry` from `./types`; `pickDownloadLink` from `./downloadTarget`; `putDownload`, `getDownload`, `deleteDownloadRecord`, `DownloadRecord` from `./downloadsStore`.
- Produces:
  - `interface Downloader { download(url: string, destPath: string): Promise<{ bytes: number }>; move(fromPath: string, toPath: string): Promise<void>; remove(path: string): Promise<void>; ensureDir(dir: string): Promise<void>; dir: string }` — the injected I/O seam (native/web impls live in `downloadIO.ts`, Task 5; NOT unit-tested).
  - `downloadEntry(entry: FeedEntry, sourceId: string, baseFeedUrl: string, io: Downloader, now?: () => string): Promise<DownloadRecord>` — resolve the link (`pickDownloadLink`; throws `FeedSourceError` if nothing downloadable), download to a `.part` path, verify `bytes > 0`, move to the final path, record in the manifest, return the record. On download failure or `bytes === 0`, remove the `.part` and throw — **no** manifest entry, **no** stray file (integrity/quarantine).
  - `removeDownload(entryId: string, io: Downloader): Promise<void>` — delete the file (via `io.remove`) then the manifest record.

**Notes for the implementer:** `downloadEntry` must call ONLY the injected `io` for I/O (never `FileSystem.*`/`fetch`). The dest paths derive from `io.dir` + a filename from the entryId + a mime-based extension. Import `FeedSourceError` from `./errors`.

- [ ] **Step 1: Write the failing test**

```typescript
// mobile/src/openshelves/__tests__/downloadEngine.test.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { downloadEntry, removeDownload, type Downloader } from "../downloadEngine";
import { getDownload, listDownloads } from "../downloadsStore";
import { FeedSourceError } from "../errors";
import type { FeedEntry } from "../types";

const BASE = "https://ex.org/f.atom";
const entry = (over: Partial<FeedEntry> = {}): FeedEntry => ({
  id: "e1", title: "Book", authors: [], summary: "", coverUrl: null, language: null, categories: [],
  mediaType: "book", rightsText: null, mature: null,
  links: [{ href: "https://ex.org/a.epub", mimeType: "application/epub+zip", rel: "http://opds-spec.org/acquisition" }],
  canonicalUrl: null, ...over,
});

function fakeIO(over: Partial<Downloader> = {}): Downloader & { moved: string[]; removed: string[] } {
  const moved: string[] = []; const removed: string[] = [];
  return {
    dir: "/dl/",
    ensureDir: jest.fn(async () => {}),
    download: jest.fn(async () => ({ bytes: 1234 })),
    move: jest.fn(async (_f, t) => { moved.push(t); }),
    remove: jest.fn(async (p) => { removed.push(p); }),
    moved, removed, ...over,
  } as any;
}

beforeEach(async () => { await AsyncStorage.clear(); });

test("downloads, verifies, records the manifest entry", async () => {
  const io = fakeIO();
  const rec = await downloadEntry(entry(), "s1", BASE, io, () => "T0");
  expect(rec).toMatchObject({ entryId: "e1", sourceId: "s1", bytes: 1234, mimeType: "application/epub+zip", downloadedAt: "T0" });
  expect(await getDownload("e1")).not.toBeNull();
  expect(io.moved.length).toBe(1); // .part → final
});

test("a zero-byte download quarantines: no record, .part removed, throws", async () => {
  const io = fakeIO({ download: jest.fn(async () => ({ bytes: 0 })) as any });
  await expect(downloadEntry(entry(), "s1", BASE, io)).rejects.toThrow();
  expect(await listDownloads()).toEqual([]);
  expect(io.removed.length).toBe(1); // .part cleaned up
});

test("a download error quarantines: no record, throws", async () => {
  const io = fakeIO({ download: jest.fn(async () => { throw new Error("net"); }) as any });
  await expect(downloadEntry(entry(), "s1", BASE, io)).rejects.toThrow();
  expect(await listDownloads()).toEqual([]);
});

test("nothing downloadable (video) throws FeedSourceError", async () => {
  const v = entry({ mediaType: "video", links: [{ href: "https://ex.org/v.mp4", mimeType: "video/mp4", rel: "x" }] });
  await expect(downloadEntry(v, "s1", BASE, fakeIO())).rejects.toBeInstanceOf(FeedSourceError);
});

test("removeDownload deletes the file and the record", async () => {
  const io = fakeIO();
  await downloadEntry(entry(), "s1", BASE, io);
  await removeDownload("e1", io);
  expect(await getDownload("e1")).toBeNull();
  expect(io.removed.length).toBeGreaterThanOrEqual(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mobile && npx jest src/openshelves/__tests__/downloadEngine.test.ts`
Expected: FAIL — cannot find module `../downloadEngine`.

- [ ] **Step 3: Write the implementation**

```typescript
// mobile/src/openshelves/downloadEngine.ts
// Orchestrates a download behind an injectable I/O seam (so it's unit-testable):
// resolve link → download to a .part → verify bytes → move to final → record.
// A failed/empty download leaves NO record and NO stray file (quarantine). The
// real native/web I/O impls live in downloadIO.ts and are NOT unit-tested here.
import type { FeedEntry } from "./types";
import { FeedSourceError } from "./errors";
import { pickDownloadLink } from "./downloadTarget";
import { deleteDownloadRecord, getDownload, putDownload, type DownloadRecord } from "./downloadsStore";

export interface Downloader {
  dir: string;
  ensureDir(dir: string): Promise<void>;
  download(url: string, destPath: string): Promise<{ bytes: number }>;
  move(fromPath: string, toPath: string): Promise<void>;
  remove(path: string): Promise<void>;
}

function extFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "application/epub+zip") return "epub";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("audio/")) return "audio";
  return "bin";
}

function safeName(entryId: string, mime: string): string {
  const slug = entryId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${slug}.${extFor(mime)}`;
}

export async function downloadEntry(
  entry: FeedEntry,
  sourceId: string,
  baseFeedUrl: string,
  io: Downloader,
  now: () => string = () => new Date().toISOString(),
): Promise<DownloadRecord> {
  const target = pickDownloadLink(entry, baseFeedUrl);
  if (!target) throw new FeedSourceError("Nothing downloadable for this entry.");

  await io.ensureDir(io.dir);
  const finalName = safeName(entry.id, target.mimeType);
  const finalPath = `${io.dir}${finalName}`;
  const partPath = `${finalPath}.part`;

  let bytes = 0;
  try {
    ({ bytes } = await io.download(target.url, partPath));
  } catch (err) {
    await io.remove(partPath).catch(() => {});
    throw new FeedSourceError(`Download failed: ${(err as Error).message}`);
  }
  if (!bytes || bytes <= 0) {
    await io.remove(partPath).catch(() => {});
    throw new FeedSourceError("Download was empty.");
  }

  await io.move(partPath, finalPath);
  const rec: DownloadRecord = {
    entryId: entry.id,
    sourceId,
    title: entry.title,
    path: finalPath,
    mimeType: target.mimeType,
    bytes,
    downloadedAt: now(),
  };
  await putDownload(rec);
  return rec;
}

export async function removeDownload(entryId: string, io: Downloader): Promise<void> {
  const rec = await getDownload(entryId);
  if (rec) await io.remove(rec.path).catch(() => {});
  await deleteDownloadRecord(entryId);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mobile && npx jest src/openshelves/__tests__/downloadEngine.test.ts`
Expected: PASS — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/downloadEngine.ts mobile/src/openshelves/__tests__/downloadEngine.test.ts
git commit -m "feat(open-shelves): download engine (injectable I/O, quarantine partials)"
```

---

### Task 4: `useDownloads` hook + Downloads screen

**Files:**
- Create: `mobile/src/openshelves/useDownloads.ts`
- Create: `mobile/app/shelves/downloads.tsx`
- Modify: `mobile/app/_layout.tsx` (register `shelves/downloads`)
- Test: `mobile/src/openshelves/__tests__/useDownloads.test.tsx`, `mobile/__tests__/app/shelves-downloads.test.tsx`

**Interfaces:**
- Produces:
  - `useDownloads(): { items: DownloadRecord[]; total: number; loading: boolean; reload(): Promise<void>; remove(entryId: string): Promise<void>; removeAll(): Promise<void> }` — wraps `listDownloads`/`totalBytes` + `removeDownload` (with the native/web `io` from `downloadIO`, Task 5). `remove`/`removeAll` reload after.
  - Downloads screen — lists items (title, size), shows total usage, per-item delete + a "Delete all" (both via `@/lib/alert` confirm), empty state.

- [ ] **Step 1: Write the failing tests**

```tsx
// mobile/src/openshelves/__tests__/useDownloads.test.tsx
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useDownloads } from "../useDownloads";
jest.mock("../downloadsStore", () => ({ listDownloads: jest.fn(), totalBytes: (r: any[]) => r.reduce((n, d) => n + d.bytes, 0) }));
jest.mock("../downloadEngine", () => ({ removeDownload: jest.fn() }));
jest.mock("../downloadIO", () => ({ makeIO: () => ({}) }));
import { listDownloads } from "../downloadsStore";
import { removeDownload } from "../downloadEngine";

const rec = (id: string, bytes = 100) => ({ entryId: id, sourceId: "s1", title: id, path: `/x/${id}`, mimeType: "application/epub+zip", bytes, downloadedAt: "T0" });
beforeEach(() => jest.clearAllMocks());

test("loads items + total on mount", async () => {
  (listDownloads as jest.Mock).mockResolvedValue([rec("a", 100), rec("b", 250)]);
  const { result } = renderHook(() => useDownloads());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.items.map((d) => d.entryId)).toEqual(["a", "b"]);
  expect(result.current.total).toBe(350);
});

test("remove calls the engine and reloads", async () => {
  (listDownloads as jest.Mock).mockResolvedValueOnce([rec("a")]).mockResolvedValueOnce([]);
  (removeDownload as jest.Mock).mockResolvedValue(undefined);
  const { result } = renderHook(() => useDownloads());
  await waitFor(() => expect(result.current.items.length).toBe(1));
  await act(async () => { await result.current.remove("a"); });
  expect(removeDownload).toHaveBeenCalledWith("a", expect.anything());
  expect(result.current.items).toEqual([]);
});
```

```tsx
// mobile/__tests__/app/shelves-downloads.test.tsx
import { render, fireEvent } from "@testing-library/react-native";
const remove = jest.fn(); const removeAll = jest.fn();
let dl: any;
jest.mock("@/openshelves/useDownloads", () => ({ useDownloads: () => dl }));
jest.mock("@/lib/alert", () => ({ Alert: { alert: jest.fn() } }));
import { Alert } from "@/lib/alert";
import DownloadsScreen from "@/../app/shelves/downloads";

const rec = (id: string) => ({ entryId: id, sourceId: "s1", title: id, path: "/x", mimeType: "application/epub+zip", bytes: 1048576, downloadedAt: "T0" });
beforeEach(() => { jest.clearAllMocks(); dl = { items: [], total: 0, loading: false, reload: jest.fn(), remove, removeAll }; });

test("empty state", () => {
  const { getByText } = render(<DownloadsScreen />);
  expect(getByText(/no downloads/i)).toBeTruthy();
});

test("lists items and confirms delete", () => {
  dl = { ...dl, items: [rec("a")], total: 1048576 };
  const { getByTestId } = render(<DownloadsScreen />);
  fireEvent.press(getByTestId("del-a"));
  expect(Alert.alert).toHaveBeenCalledTimes(1);
  expect(remove).not.toHaveBeenCalled();
  const btn = (Alert.alert as jest.Mock).mock.calls[0][2].find((b: any) => b.text === "Delete");
  btn.onPress();
  expect(remove).toHaveBeenCalledWith("a");
});
```

- [ ] **Step 2: Run to verify fail** — `cd mobile && npx jest src/openshelves/__tests__/useDownloads.test.tsx __tests__/app/shelves-downloads.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Write the implementations**

```tsx
// mobile/src/openshelves/useDownloads.ts
import { useCallback, useEffect, useState } from "react";
import { listDownloads, totalBytes, type DownloadRecord } from "./downloadsStore";
import { removeDownload } from "./downloadEngine";
import { makeIO } from "./downloadIO";

export function useDownloads() {
  const [items, setItems] = useState<DownloadRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const all = await listDownloads();
    setItems(all);
    setTotal(totalBytes(all));
    setLoading(false);
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const remove = useCallback(async (entryId: string) => {
    await removeDownload(entryId, makeIO());
    await reload();
  }, [reload]);

  const removeAll = useCallback(async () => {
    for (const d of await listDownloads()) await removeDownload(d.entryId, makeIO());
    await reload();
  }, [reload]);

  return { items, total, loading, reload, remove, removeAll };
}
```

```tsx
// mobile/app/shelves/downloads.tsx
import { ScrollView, StyleSheet, Text, View, Pressable } from "react-native";
import { Alert } from "@/lib/alert";
import { PageContainer } from "@/components/PageContainer";
import { colors, spacing, typography } from "@/constants/theme";
import { useDownloads } from "@/openshelves/useDownloads";

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DownloadsScreen() {
  const dl = useDownloads();

  const confirmDelete = (entryId: string, title: string) =>
    Alert.alert("Delete download?", `Remove "${title}" from this device?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => { void dl.remove(entryId); } },
    ]);

  const confirmDeleteAll = () =>
    Alert.alert("Delete all downloads?", "Remove every downloaded item from this device?", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete all", style: "destructive", onPress: () => { void dl.removeAll(); } },
    ]);

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      <PageContainer>
        <Text style={styles.title}>Downloads</Text>
        <View style={styles.headerRow}>
          <Text style={styles.sub}>{dl.items.length} items · {mb(dl.total)}</Text>
          {dl.items.length > 0 ? (
            <Pressable testID="del-all" onPress={confirmDeleteAll}><Text style={styles.delAll}>Delete all</Text></Pressable>
          ) : null}
        </View>
        {dl.loading && dl.items.length === 0 ? null : dl.items.length === 0 ? (
          <Text style={styles.empty}>No downloads yet. Download a book from a catalog entry.</Text>
        ) : (
          dl.items.map((d) => (
            <View key={d.entryId} style={styles.row}>
              <View style={styles.meta}>
                <Text style={styles.itemTitle} numberOfLines={1}>{d.title}</Text>
                <Text style={styles.itemSub}>{mb(d.bytes)}</Text>
              </View>
              <Pressable testID={`del-${d.entryId}`} onPress={() => confirmDelete(d.entryId, d.title)}>
                <Text style={styles.del}>Delete</Text>
              </Pressable>
            </View>
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
  delAll: { color: colors.error, fontSize: typography.sizeMd, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: spacing.sm },
  meta: { flex: 1, minWidth: 0 },
  itemTitle: { color: colors.text, fontSize: typography.sizeMd },
  itemSub: { color: colors.textMuted, fontSize: typography.sizeSm },
  del: { color: colors.error, fontSize: typography.sizeMd, fontWeight: "600" },
  empty: { color: colors.textMuted, fontSize: typography.sizeMd, marginTop: spacing.md },
});
```

Register the route in `app/_layout.tsx`: `<Stack.Screen name="shelves/downloads" options={{ headerShown: false }} />`.

- [ ] **Step 4: Run to verify pass** — `cd mobile && npx jest src/openshelves/__tests__/useDownloads.test.tsx __tests__/app/shelves-downloads.test.tsx` → all pass.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/useDownloads.ts "mobile/app/shelves/downloads.tsx" mobile/app/_layout.tsx mobile/src/openshelves/__tests__/useDownloads.test.tsx mobile/__tests__/app/shelves-downloads.test.tsx
git commit -m "feat(open-shelves): useDownloads hook + Downloads screen (list/size/delete)"
```

---

### Task 5: Real I/O impl + Download button in entry detail

**Files:**
- Create: `mobile/src/openshelves/downloadIO.ts` (native/web `Downloader`; **not** unit-tested — Task 6 verifies on device)
- Modify: `mobile/src/openshelves/EntryDetail.tsx` (add an optional `onDownload`/`downloadState` so the button shows for downloadable entries; presentational)
- Modify: `mobile/app/shelves/[sourceId]/[entryId].tsx` (wire download via the engine + `makeIO`, and a "Downloads" link)
- Test: extend `mobile/src/openshelves/__tests__/EntryDetail.test.tsx` (button shown for a book with a link, hidden for video)

**Interfaces:**
- Produces:
  - `makeIO(): Downloader` in `downloadIO.ts` — native impl over `expo-file-system` (dir = `${FileSystem.documentDirectory}open-shelves-downloads/`; `download` = `FileSystem.downloadAsync`/`createDownloadResumable` returning the on-disk size via `getInfoAsync`; `move`/`remove`/`ensureDir` = the matching `FileSystem` calls). Web impl triggers a browser download (anchor `download`) and reports it is **not** tracked as an in-app offline item (throw a clear "downloaded via your browser" signal, or return a sentinel the detail screen messages). Guard by `Platform.OS === "web"`.
  - `EntryDetail` gains `canDownload: boolean` + `onDownload?: () => void` + `downloadState?: "idle" | "downloading" | "done" | "error"` (presentational — the screen owns the engine call).

**Notes for the implementer:** `downloadIO.ts` mirrors `epubLibrary.ts`'s FileSystem usage. Because its behavior can't be unit-tested, keep it thin and obvious. The detail screen computes `canDownload = pickDownloadLink(entry, sourceUrl) !== null && entry.mediaType !== "video"`, calls `downloadEntry(entry, sourceId, sourceUrl, makeIO())` on press, and reflects state. Add a "Downloads" nav affordance to `app/shelves/downloads`.

- [ ] **Step 1: Extend the EntryDetail test (button visibility)**

```tsx
// add to mobile/src/openshelves/__tests__/EntryDetail.test.tsx
test("shows a Download button when canDownload and calls onDownload", () => {
  const onDownload = jest.fn();
  const { getByTestId } = render(<EntryDetail entry={entry()} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload onDownload={onDownload} downloadState="idle" />);
  fireEvent.press(getByTestId("download-entry"));
  expect(onDownload).toHaveBeenCalled();
});

test("no Download button when canDownload is false (e.g. video)", () => {
  const { queryByTestId } = render(<EntryDetail entry={entry({ mediaType: "video" })} sourceTitle="Lib" onViewAtSource={jest.fn()} canDownload={false} />);
  expect(queryByTestId("download-entry")).toBeNull();
});
```

- [ ] **Step 2: Run to verify fail** — the new props/testID don't exist yet.

- [ ] **Step 3: Implement** — add the `Download` button to `EntryDetail` (rendered only when `canDownload`, label reflects `downloadState`); write `downloadIO.ts` (native + web branch); wire the detail screen to compute `canDownload`, run `downloadEntry` on press with `makeIO()`, track `downloadState`, and add a link to `/shelves/downloads`. Keep `EntryDetail` presentational.

- [ ] **Step 4: Run to verify pass** — `cd mobile && npx jest src/openshelves __tests__/app && npx tsc --noEmit -p tsconfig.json` → all pass, no new tsc errors.

- [ ] **Step 5: Commit**

```bash
git add mobile/src/openshelves/downloadIO.ts mobile/src/openshelves/EntryDetail.tsx "mobile/app/shelves/[sourceId]/[entryId].tsx" mobile/src/openshelves/__tests__/EntryDetail.test.tsx
git commit -m "feat(open-shelves): real download I/O + Download button in entry detail"
```

---

### Task 6: On-device / on-web manual verification (NOT code)

> The real `FileSystem` download + web browser-download + system-handler open cannot be unit-tested. This task is a manual checklist run by the operator on a real Android device (APK/dev-client) and the web app.

- [ ] Android: download an EPUB from a real starter feed → appears in Downloads with a plausible size → survives app restart (offline) → Delete removes it (size drops) → Delete all clears.
- [ ] Android: a video entry shows **no** Download button.
- [ ] Android: kill the app mid-download → no half-item shows as available (quarantine holds).
- [ ] Web: Download triggers the browser's download; the UI clearly states it's a browser download, not in-app offline.
- [ ] Confirm the storage location message tells the user where content lives (spec P0-10).

---

## What this plan leaves to later plans

- **In-app reader for downloaded EPUB/PDF** (D2a P1) — v1 opens via system handler / browser; an in-app reader that sandboxes untrusted EPUB internals is the flagship upgrade.
- **Audio player surface** (D7) — audio downloads work; a player UI is later.
- **Starter list** (P0-5), **language filter F-1**, **auto-refresh**, **QR/deep-link** — later plans.
- **Download progress bar / cancel UI** — the engine records final size; a live progress/cancel affordance (via `createDownloadResumable` callbacks) is a UI upgrade over the current idle→done→error states.

## Self-Review

**Spec coverage (this slice):** P0-6 download EPUB/PDF/audio, video streaming-only → Tasks 1/3/5; P0-10 downloads view + per-item/bulk delete + size/total + integrity-quarantine of partials + device-local → Tasks 2/3/4; relative-URL resolution + scheme allowlist at download time → Task 1; storage-location messaging + real device behavior → Task 6 (manual). In-app reader, progress-bar UI, starter list, filters deferred.

**Placeholder scan:** none in the coded tasks (Tasks 1–4 carry full code + tests). Task 5's `downloadIO.ts` is described (not spelled out) because it is thin, platform-specific, and unverifiable in CI — the implementer mirrors `epubLibrary.ts`; Task 6 verifies it. Task 6 is intentionally a manual checklist.

**Type consistency:** `DownloadRecord` (Task 2) flows through the engine (Task 3), hook, and screen (Task 4) unchanged; `Downloader` (Task 3) is implemented by `downloadIO.makeIO` (Task 5) and injected in the engine + hook; `pickDownloadLink`/`resolveUrl` (Task 1) are consumed by the engine + the detail screen; `FeedEntry` from plan-1 types throughout.
