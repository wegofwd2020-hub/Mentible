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

const frames = new Map<string, BrowseFrameRef>();

export function publishBrowseFrame(sourceId: string, url: string, entries: FeedEntry[]): void {
  frames.set(sourceId, { url, entries });
}

export function getBrowseFrame(sourceId: string): BrowseFrameRef | null {
  return frames.get(sourceId) ?? null;
}

// Test-only escape hatch (also handy for an eventual "leave this source"
// cleanup) — not required for correctness, since a stale frame that doesn't
// contain the requested entryId simply falls through to the stored catalog.
export function clearBrowseFrame(sourceId: string): void {
  frames.delete(sourceId);
}
