// The sync-status store: a tiny module-level pub/sub so any screen can read
// "where does sync stand right now" without prop-drilling or re-fetching.
// The auto-sync controller (`autoSync.ts`) is the sole writer in normal
// operation (it calls `setSyncStatus` after every guarded run), but nothing
// stops another caller (e.g. a manual "Sync now" button in Settings, T4) from
// writing too — this module has no opinion on who writes, only on notifying
// whoever's listening.
//
// Deliberately NOT React state living in a component: the controller
// (`useAutoSync`) can run from a single mounted `SyncController` while many
// components read via `useSyncStatus` and stay in sync with each other.
import { useEffect, useState } from "react";
import type { SyncStatus } from "@/sync/syncEngine";

let current: SyncStatus = { state: "signed_out", toPush: 0, toPull: 0, lastSyncedAt: null };

const listeners = new Set<() => void>();

export function getSyncStatus(): SyncStatus {
  return current;
}

// Shallow-merges `patch` into the current status and notifies subscribers.
// Callers pass only the fields that changed (e.g. `{ state: "syncing" }`);
// unspecified fields (like the last known toPush/toPull counts) are kept so
// the UI doesn't flash to zero while a sync is in flight.
export function setSyncStatus(patch: Partial<SyncStatus>): void {
  current = { ...current, ...patch };
  for (const listener of listeners) listener();
}

function subscribeSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// React hook for components (Settings, a status pill, etc.) that want to
// re-render whenever the sync status changes.
export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(getSyncStatus());

  useEffect(() => {
    // Catch any change that happened between the initial useState seed and
    // this effect running.
    setStatus(getSyncStatus());
    return subscribeSyncStatus(() => setStatus(getSyncStatus()));
  }, []);

  return status;
}
