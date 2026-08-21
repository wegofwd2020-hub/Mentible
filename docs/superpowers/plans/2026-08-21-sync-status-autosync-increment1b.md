# Sync Status + Auto-Sync (ADR-014 Increment 1b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the user whether local matches remote (a sync-status badge) and keep devices converged automatically (auto-sync on sign-in / foreground / debounced-edit).

**Architecture:** Extract `syncNow`'s reconcile classification into a pure `planReconcile` shared by a cheap read-only `syncStatus` and the executing `syncNow` (so the badge can't disagree with a sync). A bookStore pub/sub + an app-lifecycle controller (`useAutoSync`, mounted once) drive guarded, single-flight auto-syncs and publish status to a store the Settings panel reads.

**Tech Stack:** RN+Expo, TypeScript, AsyncStorage, `react-native` `AppState`, Jest/RNTL. No backend change.

**Spec:** `docs/superpowers/specs/2026-08-21-sync-status-autosync-increment1b-design.md`

## Global Constraints

- **Behavior-preserving extraction.** Refactoring `syncNow` to use `planReconcile` must NOT change its outcome — the existing `syncEngine` tests must still pass unchanged. `planReconcile` reproduces the exact 6-branch logic (local×server presence × shadow × `isoCompare`).
- **Conflict handling unchanged** — last-write-wins by `updatedAt`. No new merge/conflict semantics.
- **Zero-knowledge unchanged** — `syncStatus` uses `listBooks` (metadata only, no ciphertext, no crypto); auto-sync reuses `syncNow` verbatim. LMK never leaves the device.
- **Auto-sync is guarded**: only when signed-in + unlocked + not IS_DEMO + toggle-on; **single-flight** (coalesce, never two concurrent syncs); **min-interval** throttle for foreground/sign-in (edit trigger exempt, debounced instead); **silent on success**, `error` badge on failure (no Alert loops), self-heals on the next trigger. **No polling timer** — all triggers are event-driven.
- **Auto-sync default ON** (`sbq_autosync_enabled`, default true when absent). Panel-only status (no global badge). Mobile-only.
- **Help DoD:** update the existing `library-sync` Help topic (no new FEATURES key — same feature).
- Run the FULL `npx jest` before finishing (a mount into the root layout can break untouched guard tests).

## File Structure

- **Modify:** `mobile/src/sync/syncEngine.ts` (add `planReconcile` + `syncStatus`; refactor `syncNow`), `mobile/src/storage/bookStore.ts` (pub/sub), `mobile/src/components/LibrarySync.tsx` (badge + toggle), `mobile/app/_layout.tsx` (mount `<SyncController/>`), `mobile/src/help-content/topics.ts` (library-sync topic).
- **Create:** `mobile/src/sync/syncStatusStore.ts` (`useSyncStatus` + store), `mobile/src/sync/autoSync.ts` (`useAutoSync` + `<SyncController/>`), tests: `mobile/__tests__/sync/planReconcile.test.ts`, `syncStatus.test.ts`, `mobile/__tests__/storage/bookStoreEvents.test.ts`, `mobile/__tests__/sync/autoSync.test.tsx`, `mobile/__tests__/components/LibrarySync.status.test.tsx`.

---

## Task 1: `planReconcile` + `syncStatus`; refactor `syncNow` (syncEngine.ts)

**Files:** Modify `mobile/src/sync/syncEngine.ts`. Create `mobile/__tests__/sync/planReconcile.test.ts`, `mobile/__tests__/sync/syncStatus.test.ts`.

**Interfaces (produced):**
```ts
export interface ReconcilePlan { toPush: string[]; toPull: string[]; toDeleteLocal: string[]; toPushDelete: string[]; shadowDrop: string[]; }
export function planReconcile(
  localIndex: { id: string; updatedAt: string }[],
  serverManifest: { bookId: string; clientVersion: string; deleted: boolean; updatedAt: string | null }[],
  shadow: Set<string>,
): ReconcilePlan;
export type SyncState = "up_to_date" | "pending" | "syncing" | "error" | "locked" | "signed_out";
export interface SyncStatus { state: SyncState; toPush: number; toPull: number; lastSyncedAt: string | null; }
export function syncStatus(token: string | null): Promise<SyncStatus>;
```

- [ ] **Step 1: Write failing `planReconcile` tests** — one case per branch (verify the classifier reproduces `syncNow`'s 6-branch logic exactly):
```ts
// mobile/__tests__/sync/planReconcile.test.ts
import { planReconcile } from "@/sync/syncEngine";
const S = (bookId: string, o: Partial<{clientVersion:string;deleted:boolean;updatedAt:string}> = {}) =>
  ({ bookId, clientVersion: o.clientVersion ?? "2026-01-01T00:00:00.000Z", deleted: o.deleted ?? false, updatedAt: o.updatedAt ?? "2026-01-01T00:00:00.000Z" });
const L = (id: string, updatedAt = "2026-01-01T00:00:00.000Z") => ({ id, updatedAt });

it("local-only → toPush", () => {
  expect(planReconcile([L("a")], [], new Set()).toPush).toEqual(["a"]);
});
it("local newer than live server → toPush; server newer → toPull; equal → neither", () => {
  const newer = "2026-02-01T00:00:00.000Z", older = "2025-12-01T00:00:00.000Z";
  expect(planReconcile([L("a", newer)], [S("a")], new Set()).toPush).toEqual(["a"]);
  expect(planReconcile([L("a", older)], [S("a")], new Set()).toPull).toEqual(["a"]);
  const eq = planReconcile([L("a")], [S("a")], new Set());
  expect(eq.toPush.concat(eq.toPull)).toEqual([]);
});
it("server tombstone newer-or-equal → toDeleteLocal; local edited after tombstone → toPush", () => {
  const tomb = "2026-03-01T00:00:00.000Z";
  expect(planReconcile([L("a", "2026-01-01T00:00:00.000Z")], [S("a", { deleted: true, updatedAt: tomb })], new Set()).toDeleteLocal).toEqual(["a"]);
  expect(planReconcile([L("a", "2026-04-01T00:00:00.000Z")], [S("a", { deleted: true, updatedAt: tomb })], new Set()).toPush).toEqual(["a"]);
});
it("server-live not-in-shadow → toPull (peer add); in-shadow local-gone → toPushDelete", () => {
  expect(planReconcile([], [S("a")], new Set()).toPull).toEqual(["a"]);
  expect(planReconcile([], [S("a")], new Set(["a"])).toPushDelete).toEqual(["a"]);
});
it("both gone / stale shadow → shadowDrop, no action", () => {
  expect(planReconcile([], [S("a", { deleted: true })], new Set(["a"])).shadowDrop).toContain("a");
  expect(planReconcile([], [], new Set(["a"])).shadowDrop).toContain("a");
});
```

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement `planReconcile`** — lift the classification out of `syncNow`'s loop (lines ~204-258), returning lists instead of executing. Reuse the existing module-private `isoCompare`. Pure (no I/O, no shadow mutation):
```ts
export interface ReconcilePlan { toPush: string[]; toPull: string[]; toDeleteLocal: string[]; toPushDelete: string[]; shadowDrop: string[]; }
export function planReconcile(localIndex, serverManifest, shadow): ReconcilePlan {
  const serverById = new Map(serverManifest.map((b) => [b.bookId, b]));
  const localById = new Map(localIndex.map((m) => [m.id, m]));
  const allIds = new Set<string>([...serverById.keys(), ...localById.keys(), ...shadow]);
  const p: ReconcilePlan = { toPush: [], toPull: [], toDeleteLocal: [], toPushDelete: [], shadowDrop: [] };
  for (const id of allIds) {
    const local = localById.get(id); const server = serverById.get(id);
    if (local && !server) p.toPush.push(id);
    else if (local && server && !server.deleted) {
      const cmp = isoCompare(local.updatedAt, server.clientVersion);
      if (cmp > 0) p.toPush.push(id); else if (cmp < 0) p.toPull.push(id); // cmp===0 → skip
    } else if (local && server && server.deleted) {
      if (isoCompare(local.updatedAt, server.updatedAt) <= 0) p.toDeleteLocal.push(id);
      else p.toPush.push(id);
    } else if (!local && server && !server.deleted) {
      if (shadow.has(id)) p.toPushDelete.push(id); else p.toPull.push(id);
    } else { // (!local && server && server.deleted) || (!local && !server)
      p.shadowDrop.push(id);
    }
  }
  return p;
}
```

- [ ] **Step 4: Refactor `syncNow` to consume `planReconcile`** — behavior-preserving. Replace the inline loop (204-262) with: build the plan, apply `shadowDrop` to the shadow set (no I/O), then execute each action list with the SAME per-item try/catch → `failed`, incrementing `pushed`/`pulled`/`deleted` and mutating the shadow on success exactly as before:
```ts
const plan = planReconcile(localIndex, serverBooks.map(b => ({ bookId: b.bookId, clientVersion: b.clientVersion, deleted: b.deleted, updatedAt: b.updatedAt })), shadow);
for (const id of plan.shadowDrop) shadow.delete(id);
for (const id of plan.toPush)       { try { await push(id); shadow.add(id); } catch { failed.push(id); } }
for (const id of plan.toPull)       { try { await pull(id); shadow.add(id); } catch { failed.push(id); } }
for (const id of plan.toDeleteLocal){ try { await deleteLocalBook(id); shadow.delete(id); deleted++; } catch { failed.push(id); } }
for (const id of plan.toPushDelete) { try { await syncClient.deleteBook(token, id); shadow.delete(id); deleted++; } catch { failed.push(id); } }
await saveShadow(shadow);
await AsyncStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString());
return { pushed, pulled, deleted, failed };
```
Keep `push`/`pull` helpers as-is (they still `pushed++`/`pulled++`). Confirm the ORIGINAL `syncEngine` sync tests still pass (behavior preserved).

- [ ] **Step 5: Write failing `syncStatus` tests** (mock `syncClient.listBooks`, `bookStore.loadBookIndex`, `lmkStore.loadLMK`/`isUnlocked`, `getLastSyncedAt`):
  - null token → `{state:"signed_out"}`.
  - unlocked=false (no LMK) → `{state:"locked"}`.
  - empty plan → `up_to_date`, toPush/toPull 0.
  - local-only + server-newer → `pending`, toPush=1 (incl toPushDelete), toPull=1 (incl toDeleteLocal).
  - `listBooks` throws → `error`, lastSyncedAt still attached.

- [ ] **Step 6: Implement `syncStatus`:**
```ts
export async function syncStatus(token: string | null): Promise<SyncStatus> {
  const lastSyncedAt = await getLastSyncedAt();
  if (!token) return { state: "signed_out", toPush: 0, toPull: 0, lastSyncedAt };
  if (!(await isUnlocked())) return { state: "locked", toPush: 0, toPull: 0, lastSyncedAt };
  try {
    const [server, local, shadow] = await Promise.all([syncClient.listBooks(token), loadBookIndex(), loadShadow()]);
    const p = planReconcile(local, server, shadow);
    const toPush = p.toPush.length + p.toPushDelete.length;
    const toPull = p.toPull.length + p.toDeleteLocal.length;
    return { state: toPush + toPull === 0 ? "up_to_date" : "pending", toPush, toPull, lastSyncedAt };
  } catch {
    return { state: "error", toPush: 0, toPull: 0, lastSyncedAt };
  }
}
```
(`isUnlocked` already exported; `loadShadow` is module-private — reuse in-file.)

- [ ] **Step 7: Run `npx jest syncEngine planReconcile syncStatus` + `npx tsc --noEmit`.** Commit: `feat(sync): planReconcile + syncStatus (shared classifier for badge==sync)`

---

## Task 2: bookStore change-notification (pub/sub)

**Files:** Modify `mobile/src/storage/bookStore.ts`. Create `mobile/__tests__/storage/bookStoreEvents.test.ts`.

**Interfaces (produced):** `export function subscribeBookStore(listener: () => void): () => void;`

- [ ] **Step 1: Failing test:**
```ts
import { subscribeBookStore, saveBook, deleteBook } from "@/storage/bookStore";
it("notifies on save and delete, and unsubscribe stops it", async () => {
  let n = 0; const off = subscribeBookStore(() => { n++; });
  await saveBook({ id: "b1", title: "T", toc: { subjects: [] }, createdAt: "x", updatedAt: "x" } as any);
  await deleteBook("b1");
  expect(n).toBe(2);
  off(); await saveBook({ id: "b2", title: "T", toc: { subjects: [] }, createdAt: "x", updatedAt: "x" } as any);
  expect(n).toBe(2);
});
```
(mock AsyncStorage as the existing bookStore tests do.)

- [ ] **Step 2: Run, verify fail.**

- [ ] **Step 3: Implement** a module-level listener set + emit, called at the END of `saveBook` and `deleteBook` (after `AsyncStorage.setItem`):
```ts
const _listeners = new Set<() => void>();
export function subscribeBookStore(listener: () => void): () => void { _listeners.add(listener); return () => _listeners.delete(listener); }
function _emit() { for (const l of _listeners) { try { l(); } catch { /* a listener must not break a save */ } } }
```
Add `_emit();` as the last line of `saveBook` and `deleteBook`.

- [ ] **Step 4: Run `npx jest bookStore` + `npx tsc --noEmit`.** Commit: `feat(bookStore): subscribeBookStore change events`

---

## Task 3: status store + auto-sync controller

**Files:** Create `mobile/src/sync/syncStatusStore.ts`, `mobile/src/sync/autoSync.ts`, `mobile/__tests__/sync/autoSync.test.tsx`. Consumes T1 (`syncNow`/`syncStatus`), T2 (`subscribeBookStore`).

**Interfaces (produced):**
- `syncStatusStore.ts`: `export function useSyncStatus(): SyncStatus;` + internal `setSyncStatus(s)` / `getSyncStatus()`.
- `autoSync.ts`: `export function useAutoSync(): void;` and `export function SyncController(): null;` (calls the hook, renders null). `export const AUTOSYNC_ENABLED_KEY = "sbq_autosync_enabled";` + `isAutoSyncEnabled()`/`setAutoSyncEnabled(bool)`.

- [ ] **Step 1: Implement `syncStatusStore.ts`** — a module-level `SyncStatus` + `Set` of listeners + a `useSyncStatus` hook (`useState` + `useEffect` subscribe). Seed `{ state: "signed_out", toPush: 0, toPull: 0, lastSyncedAt: null }`. `setSyncStatus` merges + notifies.

- [ ] **Step 2: Write failing controller tests** (`autoSync.test.tsx`; render a component that calls `useAutoSync`; mock `@/sync/syncEngine` (`syncNow`, `syncStatus`, `isUnlocked`), `@/storage/bookStore` (`subscribeBookStore`), `@/auth/AuthProvider` (`useAuth`), and `react-native` `AppState`; fake timers):
  - signed_in + unlocked on mount → calls `syncNow` once.
  - `AppState` → "active" → calls `syncNow` (respecting min-interval: a second "active" within the interval does NOT).
  - a `subscribeBookStore` emit → after the debounce window → calls `syncNow`.
  - single-flight: a trigger while `syncNow`'s promise is pending → does not start a second; exactly one rerun after it resolves if a trigger arrived mid-run.
  - guards: locked (`isUnlocked` false) / signed_out / `IS_DEMO` / toggle-off (`AUTOSYNC_ENABLED_KEY` = "false") → `syncNow` NOT called.
  - `syncNow` rejects → status store set to `error`, no throw, no Alert.

- [ ] **Step 3: Implement `useAutoSync`** — the guarded single-flight runner + the three trigger wirings + cleanup. Constants: `const DEBOUNCE_MS = 4000; const MIN_INTERVAL_MS = 15000;`. Module-level `running`/`rerunQueued`/`lastRunAt`. `requestSync(reason)` checks guards (toggle via `isAutoSyncEnabled()`, `!IS_DEMO`, `useAuth().status==="signed_in" && accessToken`, `await isUnlocked()`, min-interval for `"foreground"|"signin"`). Runner: set store `syncing` → `await syncNow(token)` → recompute `syncStatus(token)` into the store (with the fresh `lastSyncedAt`) → stamp `lastRunAt`; on throw → store `error`; finally clear `running` + drain `rerunQueued`. Effects: `AppState.addEventListener("change", …)`; `subscribeBookStore(debouncedRequest)`; an effect on `useAuth().status` (fire on → `signed_in`). Return cleanup that removes all + clears the debounce timer. `SyncController` = `() => { useAutoSync(); return null; }`.

- [ ] **Step 4: Run `npx jest autoSync` + `npx tsc --noEmit`.** Commit: `feat(sync): auto-sync controller (sign-in/foreground/edit, guarded) + status store`

---

## Task 4: mount + Settings UI (badge + auto-sync toggle)

**Files:** Modify `mobile/app/_layout.tsx` (mount `<SyncController/>` inside `AuthProvider`), `mobile/src/components/LibrarySync.tsx`. Create `mobile/__tests__/components/LibrarySync.status.test.tsx`.

- [ ] **Step 1: Mount the controller** — in `app/_layout.tsx`, render `<SyncController />` inside `<AuthProvider>` (it needs `useAuth`), as a sibling of the existing tree (renders null). Import from `@/sync/autoSync`.

- [ ] **Step 2: Write failing `LibrarySync.status` tests** (RNTL; mock `useSyncStatus`, `@/sync/autoSync` `isAutoSyncEnabled`/`setAutoSyncEnabled`, `syncEngine`):
  - `useSyncStatus` = `up_to_date` → renders "Up to date"; `pending` w/ toPush 2 → renders a "to sync" count; `syncing` → renders "Syncing…"; `error` → renders "Couldn't sync"; `locked` → the unlock prompt still shows.
  - auto-sync toggle reflects `isAutoSyncEnabled()` and calls `setAutoSyncEnabled` on change.
  - manual "Sync now" still calls `syncNow`.

- [ ] **Step 3: Implement the UI** — in `LibrarySync.tsx`, in the unlocked branch add: a status line driven by `useSyncStatus()` (map each state to copy per the spec; show a relative "synced Xm ago" using `lastSyncedAt`), and an **Auto-sync** toggle (RN `Switch`, seeded from `isAutoSyncEnabled()`, persists via `setAutoSyncEnabled`). Keep the existing "Sync now" + last-synced. On mount / when the panel focuses, call `syncStatus(token)` once → `setSyncStatus` so the badge is fresh without forcing a full sync. Errors via `@/lib/alert` only for explicit user actions, never for the passive badge.

- [ ] **Step 4: `npx jest LibrarySync && npx tsc --noEmit`, THEN the FULL `npx jest`** (the `_layout` mount can break an untouched root/guard test — this is the real gate). Fix any breakage your mount caused. Commit: `feat(sync): Settings sync-status badge + auto-sync toggle; mount controller`

---

## Task 5: Help — auto-sync + status in the library-sync topic

**Files:** Modify `mobile/src/help-content/topics.ts` (the `library-sync` topic).

- [ ] Add a short block to the existing `library-sync` topic (no new FEATURES key): that sync now **runs automatically** (on sign-in, when you reopen the app, and shortly after you edit a book) once enabled + unlocked; that **Settings → Sync shows the status** (Up to date / changes to sync / syncing / couldn't sync); and that you can **turn Auto-sync off** to sync only with the button. Keep it accurate to Increment 1b (books only; last-write-wins if two devices edit the same book). Run `npx jest --testPathPattern=help`. Commit: `docs(help): auto-sync + sync status in the library-sync topic`

---

## Self-Review

- **Spec coverage:** planReconcile+syncStatus → T1; bookStore pub/sub → T2; status store + controller → T3; mount + badge + toggle → T4; Help → T5. Every spec unit maps to a task.
- **Type consistency:** `ReconcilePlan`/`SyncStatus`/`SyncState` defined in T1 consumed by T3 (`syncStatus`, store) + T4 (`useSyncStatus`); `subscribeBookStore` (T2) consumed by T3; `useAutoSync`/`SyncController`/`isAutoSyncEnabled` (T3) consumed by T4. `AUTOSYNC_ENABLED_KEY` = `"sbq_autosync_enabled"`.
- **Behavior-preservation risk (T1):** the whole point is that the refactored `syncNow` produces identical results — the existing sync tests are the guard; the plan says keep them passing unchanged. The one subtlety: the original loop mutated the shadow *inline as it iterated* while the refactor applies `shadowDrop` up-front then mutates on execution — outcome is identical because shadow-adds/deletes are idempotent and order-independent within a single run (each id is classified once).
- **Guard-test risk (T4):** flagged — full `npx jest` required after the `_layout` mount.
- **No placeholders:** DEBOUNCE_MS=4000, MIN_INTERVAL_MS=15000, key `sbq_autosync_enabled` are concrete.
