import AsyncStorage from "@react-native-async-storage/async-storage";
import { listSources, getSource, putSource, deleteSourceRecord } from "../feedSourcesStore";
import type { FeedSource } from "../types";

const mk = (id: string, over: Partial<FeedSource> = {}): FeedSource => ({
  id, url: `https://ex.org/${id}`, title: null, addedAt: "2026-07-12T00:00:00Z",
  lastRefreshedAt: null, isStarter: false, entryCount: 0, ...over,
});

beforeEach(async () => { await AsyncStorage.clear(); });

test("upsert appends new and replaces existing by id", async () => {
  await putSource(mk("a", { entryCount: 2 }));
  await putSource(mk("b"));
  await putSource(mk("a", { entryCount: 9 })); // replace, not duplicate
  const all = await listSources();
  expect(all.map((s) => s.id)).toEqual(["a", "b"]);
  expect((await getSource("a"))?.entryCount).toBe(9);
  expect(await getSource("missing")).toBeNull();
});

test("deleteSourceRecord removes only that record", async () => {
  await putSource(mk("a"));
  await putSource(mk("b"));
  await deleteSourceRecord("a");
  expect((await listSources()).map((s) => s.id)).toEqual(["b"]);
});

test("corrupt blob reads back as empty", async () => {
  await AsyncStorage.setItem("sbq_feed_sources", "nope");
  expect(await listSources()).toEqual([]);
});
