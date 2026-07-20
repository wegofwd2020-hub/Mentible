import { reconcileEntries } from "../reconcile";
import type { FeedEntry } from "../types";

const mk = (id: string, title = "t"): FeedEntry => ({
  id, title, authors: [], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "book", rightsText: null, mature: null,
  links: [], canonicalUrl: null, navigationUrl: null,
});

test("adds new entries", () => {
  const r = reconcileEntries([], [mk("a"), mk("b")]);
  expect(r.merged.map((e) => e.id)).toEqual(["a", "b"]);
  expect(r).toMatchObject({ added: 2, updated: 0, removed: 0 });
});

test("double refresh of the same feed produces no duplicates", () => {
  const feed = [mk("a"), mk("b")];
  const once = reconcileEntries([], feed);
  const twice = reconcileEntries(once.merged, feed);
  expect(twice.merged.map((e) => e.id)).toEqual(["a", "b"]);
  expect(twice).toMatchObject({ added: 0, updated: 0, removed: 0 });
});

test("prunes entries no longer in the feed", () => {
  const r = reconcileEntries([mk("a"), mk("b")], [mk("a")]);
  expect(r.merged.map((e) => e.id)).toEqual(["a"]);
  expect(r.removed).toBe(1);
});

test("updates changed entries, counts them", () => {
  const r = reconcileEntries([mk("a", "old")], [mk("a", "new")]);
  expect(r.merged[0].title).toBe("new");
  expect(r).toMatchObject({ added: 0, updated: 1, removed: 0 });
});
