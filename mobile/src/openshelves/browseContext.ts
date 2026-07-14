// Transient, in-memory handoff of the CURRENT browse frame across the
// expo-router navigation boundary (FIX 1). The catalog is a tree
// (useFeedBrowser): a leaf entry reached inside a drilled-in sub-feed was
// never written to the per-source store (feedEntriesStore) — only the
// top-level catalog is stored (spec N2, invariant). By the time the pushed
// [entryId] route mounts, the catalog screen (and useFeedBrowser's `pushed`
// stack, which is component useState) has unmounted, so the entry and the
// URL of the frame it came from must be carried across some other way.
//
// This is that "some other way": a plain module-level Map, keyed by
// sourceId, holding the most recently published { url, entries } for that
// source's current browse frame. NOT AsyncStorage. NOT feedEntriesStore /
// feedStore. NOT React state — a process restart (or a fresh module load)
// legitimately has nothing here; callers MUST fall back to the stored
// catalog in that case (see [entryId].tsx). Module-level memory persists
// across a React unmount/remount within the same JS process (which is
// exactly what an expo-router push does), so publishing the frame right
// before navigating is enough — no provider, no context rewiring needed.
import type { FeedEntry } from "./types";

export interface BrowseFrameRef {
  url: string;
  entries: FeedEntry[];
}

// Intentionally unbounded-but-small: one entry per distinct source the user
// has opened the catalog screen for in this process lifetime, not per
// navigation. `clearBrowseFrame` exists for a future "source removed"
// cleanup (deleting a source should probably drop its entry here too); no
// caller does that yet.
const frames = new Map<string, BrowseFrameRef>();

export function publishBrowseFrame(sourceId: string, url: string, entries: FeedEntry[]): void {
  frames.set(sourceId, { url, entries });
}

export function getBrowseFrame(sourceId: string): BrowseFrameRef | null {
  return frames.get(sourceId) ?? null;
}

// Test-only escape hatch (also handy for an eventual "leave this source"
// cleanup).
//
// A stale frame here is NOT caught by the [entryId].tsx fallback: it falls
// through to the stored catalog only when the requested entryId is absent
// from the stale frame. If a stale frame happens to contain an entry whose
// id COLLIDES with a root-level entry, it resolves silently against the
// stale frame's (wrong) base URL. The registry stays correct today only
// because the catalog screen's publish effect is keyed on `browser.frame`'s
// identity and therefore re-fires on both enter() AND back() (see
// useFeedBrowser.back(), which replaces `pushed` with a new array) —
// overwriting the registry with the true root frame before the user can tap
// anything. That re-fire-on-back() behavior is pinned by a regression test
// in shelves-catalog.test.tsx; don't assume the fallback alone makes a
// stale frame safe.
export function clearBrowseFrame(sourceId: string): void {
  frames.delete(sourceId);
}
