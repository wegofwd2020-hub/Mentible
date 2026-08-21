# Sync Status + Auto-Sync — Increment 1b — Design Spec

**Status:** Proposed · **Date:** 2026-08-21 · **Area:** `mobile/src/sync/*`, `mobile/src/storage/bookStore.ts`, `mobile/src/components/LibrarySync.tsx`, `mobile/app/_layout.tsx` · **Builds on:** ADR-014 Increment 1 (`docs/superpowers/specs/2026-08-20-zk-library-sync-increment1-design.md`) · manual "Sync now" already shipped.

## Why

Increment 1 shipped **manual** sync: a "Sync now" button + a last-synced timestamp. Between syncs the user has **no way to know if local matches remote** — a local edit or a peer device's push silently makes them stale, and the only way to find out is to tap the button. This increment closes that gap two ways: (1) a **sync-status indicator** so "am I in sync?" is answerable at a glance, and (2) **auto-sync** so devices actually converge without the user babysitting a button. Multi-device is the whole reason sync exists, so keeping devices current must be automatic, not manual.

## Decisions (locked with the user)

- **Auto-sync ON by default**, with a Settings toggle to switch to manual-only.
- **Triggers:** sign-in, app-foreground, and debounced-on-local-edit — all guarded.
- **Status indicator:** in the Settings `LibrarySync` panel only (no global/nav badge in 1b).
- **Conflict handling unchanged** — last-write-wins by `updatedAt` (concurrent-edit conflict-copy stays Increment 4).
- **Single-login is NOT introduced** — restricting to one device would defeat sync; multi-device stays.

## Architecture — five units

### 1. `planReconcile` — shared, pure classifier (`syncEngine.ts`)

`syncNow` today interleaves *classification* (which of the 6 branches an id falls in) with *execution* (push/pull/delete). Extract the classification into a pure function so **status and sync can never disagree**:

```ts
export interface ReconcilePlan {
  toPush: string[];        // local-only, or local newer than server (live)
  toPull: string[];        // server-only-not-in-shadow, or server newer (live)
  toDeleteLocal: string[]; // server tombstone wins over local
  toPushDelete: string[];  // in shadow, local gone, server still live → push tombstone
}
export function planReconcile(
  localIndex: { id: string; updatedAt: string }[],
  serverManifest: { bookId: string; clientVersion: string; deleted: boolean; updatedAt: string | null }[],
  shadow: Set<string>,
): ReconcilePlan
```

It applies the **exact same 6-branch logic** the current `syncNow` loop uses (local×server presence × shadow membership × `isoCompare`), returning lists instead of executing. `syncNow` is refactored to call `planReconcile` then execute each list (preserving per-book try/catch → `failed[]`, and the shadow bookkeeping). No behavior change to `syncNow`'s outcome — this is a pure extraction covered by the existing sync tests plus a direct `planReconcile` test.

### 2. `syncStatus(token)` — cheap read-only check (`syncEngine.ts`)

```ts
export type SyncState = "up_to_date" | "pending" | "syncing" | "error" | "locked" | "signed_out";
export interface SyncStatus {
  state: SyncState;
  toPush: number;   // toPush + toPushDelete
  toPull: number;   // toPull + toDeleteLocal
  lastSyncedAt: string | null;
}
export async function syncStatus(token: string | null): Promise<SyncStatus>
```

- No token → `signed_out`. Not unlocked (`isUnlocked()` false, keyset exists) → `locked`.
- Else: `Promise.all([syncClient.listBooks(token), loadBookIndex(), loadShadow()])` → `planReconcile` → counts. `both 0 → up_to_date`, else `pending`. Always attaches `getLastSyncedAt()`.
- Any thrown error (network/401) → `error` (with last-synced still attached). **Metadata only — no ciphertext fetched, no crypto, no transfer.** Cheap enough to run on panel-open, foreground, and after edits.
- `syncing` is not produced by `syncStatus` itself — the status store sets it while a `syncNow` is in flight (unit 4).

### 3. Change-notification seam (`bookStore.ts`)

A tiny in-memory pub/sub so auto-sync and the badge react to local edits:

```ts
export function subscribeBookStore(listener: () => void): () => void  // returns unsubscribe
```

`saveBook` and `deleteBook` call an internal `emit()` **after** the `AsyncStorage.setItem` completes. Listeners are held in a module-level `Set`; no persistence, no payload (listeners re-read as needed). Import-only bundling (existing `.book` import path also routes through `saveBook`, so imports notify too).

### 4. Auto-sync controller (`autoSync.ts` + `useAutoSync`, mounted once)

A hook mounted once high in the tree (inside `AuthProvider`, see unit 5's mount) that wires the three triggers to a **single guarded runner**:

- **Triggers → `requestSync(reason)`:**
  - **sign-in:** `useAuth().status` transitions to `"signed_in"` (and on mount if already signed in).
  - **foreground:** `AppState` change to `"active"` (`react-native` `AppState.addEventListener`).
  - **on-edit:** `subscribeBookStore` fires → **debounced ~4s** (batch rapid edits) → request.
- **`requestSync(reason)` guards** (all must pass, else no-op — silent):
  - auto-sync toggle on (`sbq_autosync_enabled`, default true); not `IS_DEMO`; `status === "signed_in"` with a non-null `accessToken`; `isUnlocked()` true.
  - **single-flight:** a module `running` flag — a request while running sets a `rerunQueued` flag instead of starting a second sync; the runner re-checks it on finish.
  - **min-interval throttle:** the *foreground* and *sign-in* triggers skip if the last run was < `MIN_INTERVAL` (e.g. 15s) ago; the *edit* trigger is exempt (its debounce is its throttle) so edits always eventually push.
- **Runner:** set status `syncing` → `await syncNow(token)` → write the returned `SyncResult` into the status store, then recompute `syncStatus` for fresh counts, stamp last-run time. **Silent on success** (no Alert). On throw → status `error` (no Alert; retried on the next trigger — Supabase refreshes the token in the background so a 401 self-heals). Always clear `running`; if `rerunQueued`, run once more.
- **Cleanup:** the hook removes AppState + bookStore + auth listeners and cancels the debounce timer on unmount.

The controller **reuses `syncNow` verbatim** — no new sync/merge logic, no new conflict semantics.

### 5. Status store + UI (`useSyncStatus` + `LibrarySync.tsx`, mount in `_layout.tsx`)

- **Status store** (`syncStatusStore.ts`): a module-level current `SyncStatus` + `subscribe`, exposed as `useSyncStatus()`. The controller (unit 4) is the writer; `LibrarySync` and any future surface are readers. Keeps the controller (runs once, app-wide) decoupled from the panel (mounts/unmounts).
- **Mount:** a `<SyncController/>` component that calls `useAutoSync()` and renders `null`, placed **inside `AuthProvider`** in `app/_layout.tsx` (it needs `useAuth`). One instance, app-lifetime.
- **`LibrarySync` panel additions** (unlocked state):
  - **Status badge** from `useSyncStatus()`: `up_to_date` → "Up to date ✓ · synced {relative time}"; `pending` → "{N} change(s) to sync"; `syncing` → "Syncing…" + spinner; `error` → "Couldn't sync — will retry"; `locked` → the existing unlock prompt; `signed_out` → hidden (panel already gated by RequireSignIn).
  - **Auto-sync toggle** (RN `Switch` or the app's toggle), persisted to `sbq_autosync_enabled` (default on). Off → the controller's guards short-circuit (manual only).
  - Keep manual **"Sync now"** + last-synced. On panel open, run `syncStatus` once to paint the badge without forcing a full sync.

## Data flow

```
triggers (sign-in / foreground / edit-debounced)
      → useAutoSync.requestSync → [guards] → syncNow(token)
      → syncStatusStore.set(syncing→result→syncStatus) → useSyncStatus → LibrarySync badge

panel open / bookStore edit → syncStatus(token) [cheap] → syncStatusStore.set → badge
```

## Error handling

- Network / 401 / server 5xx during `syncNow` or `syncStatus` → `error` state, **silent** (badge only, never an Alert loop), retried on the next trigger.
- `SyncLockedError` (no LMK) → `locked` state, no auto-sync attempts (nothing to do until the user unlocks with the recovery key).
- Coalesced triggers never stack a second concurrent `syncNow` (single-flight).
- The debounce + min-interval keep auto-sync from hammering the backend or the battery; there is **no polling timer** — every trigger is event-driven.

## Security / privacy (unchanged from Increment 1)

- `syncStatus` uses `listBooks` (metadata: id + version + tombstone), never ciphertext; auto-sync uses `syncNow` (envelope crypto unchanged). Server still stores ciphertext only; the LMK never leaves the device.
- New persisted keys are non-secret: `sbq_autosync_enabled` (bool). Reuses existing `sbq_sync_shadow`, `sbq_sync_last_synced_at`.

## Non-goals (1b)

- No conflict-copy / merge UI — LWW by `updatedAt` unchanged (Increment 4).
- No global/nav status indicator — Settings panel only.
- No EPUB / shelves sync (Increment 2); no key sync (Increment 3).
- No background sync while the app is backgrounded/closed — triggers are foreground-lifecycle only.
- No single-device restriction.

## Testing

- **`planReconcile`** (pure): for each of the 6 branches, the right id lands in the right list; matches what `syncNow` executes (a table test). Regression: the existing `syncNow` tests still pass after the extraction (behavior-preserving).
- **`syncStatus`:** `signed_out` (null token), `locked` (no LMK), `up_to_date` (empty plan), `pending` (counts = toPush+toPushDelete / toPull+toDeleteLocal), `error` (listBooks throws). Counts equal what a subsequent `syncNow` would move.
- **`bookStore` pub/sub:** `subscribeBookStore` fires on `saveBook`/`deleteBook`; unsubscribe stops it; no fire on a read.
- **`useAutoSync` controller** (mock `syncNow`, `AppState`, `useAuth`, `subscribeBookStore`, timers): each trigger requests a sync; sign-in/foreground respect min-interval; edit debounces then fires; single-flight coalesces (a request mid-run → exactly one rerun); guards block when locked / signed-out / demo / toggle-off; a `syncNow` throw sets `error` and does not crash or Alert.
- **`LibrarySync`:** renders each badge state from `useSyncStatus`; the auto-sync toggle persists and gates; manual "Sync now" still works.
- **`_layout` mount:** `<SyncController/>` mounts once inside `AuthProvider` without breaking existing layout/guard tests (run the full `npx jest` — a mount into the root layout can break untouched guard tests).

## Rollout

Mobile-only (no backend change — `listBooks` already exists and is rate-limited). Ships to web on the next web deploy and to Android on the next APK (vc46). Feature is on-by-default once a user has enabled + unlocked sync; users who never enabled sync see nothing new.
