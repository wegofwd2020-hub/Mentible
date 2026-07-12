// Orchestration: composes the plan-1 engine (validate → fetch → parse → reconcile)
// with the persistence layers into add/refresh/remove operations. Network is
// injectable (opts.fetchImpl) so tests never hit the wire.
import { randomUUID } from "@/lib/uuid";
import type { FeedSource } from "./types";
import { validateFeedUrl, fetchFeed } from "./fetchFeed";
import { parseOpds12 } from "./opds12";
import { reconcileEntries } from "./reconcile";
import { putEntries, getEntries, deleteEntries } from "./feedEntriesStore";
import { putSource, getSource, listSources, deleteSourceRecord } from "./feedSourcesStore";
import { FeedRefreshError } from "./errors";

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
