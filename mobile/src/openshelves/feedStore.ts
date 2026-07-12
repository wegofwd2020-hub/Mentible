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
