// Idempotent refresh reconcile (spec P0-4): upsert incoming entries by Atom id,
// prune entries the feed no longer lists, never duplicate. Pure — the caller owns
// persistence and the "keep prev on failed fetch" partial-failure rule.
import type { FeedEntry } from "./types";

export interface ReconcileResult {
  merged: FeedEntry[];
  added: number;
  updated: number;
  removed: number;
}

export function reconcileEntries(prev: FeedEntry[], incoming: FeedEntry[]): ReconcileResult {
  const prevById = new Map(prev.map((e) => [e.id, e]));
  const incomingIds = new Set(incoming.map((e) => e.id));
  const merged: FeedEntry[] = [];
  const seen = new Set<string>();
  let added = 0;
  let updated = 0;

  for (const e of incoming) {
    if (seen.has(e.id)) continue; // guard against duplicate ids within one feed
    seen.add(e.id);
    const before = prevById.get(e.id);
    if (!before) added += 1;
    else if (JSON.stringify(before) !== JSON.stringify(e)) updated += 1;
    merged.push(e);
  }

  const removed = prev.reduce((n, e) => (incomingIds.has(e.id) ? n : n + 1), 0);
  return { merged, added, updated, removed };
}
