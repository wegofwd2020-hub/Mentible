import AsyncStorage from "@react-native-async-storage/async-storage";
import { seedStarterSources, restoreStarterSources } from "../seedStarterSources";
import { STARTER_SOURCES } from "../starterSources";
import { listSources, deleteSourceRecord } from "../feedSourcesStore";
import * as fetchFeedMod from "../fetchFeed";

const opts = { now: () => "2026-07-20T00:00:00.000Z", newId: (() => { let n = 0; return () => `id-${n++}`; })() };

beforeEach(async () => { await AsyncStorage.clear(); });

it("seeds every starter shelf on a clean install, marked isStarter", async () => {
  const res = await seedStarterSources(opts);
  expect(res.seeded.sort()).toEqual(STARTER_SOURCES.map((s) => s.url).sort());
  const sources = await listSources();
  expect(sources).toHaveLength(STARTER_SOURCES.length);
  for (const s of sources) {
    expect(s.isStarter).toBe(true);
    expect(s.lastRefreshedAt).toBeNull();
    expect(s.entryCount).toBe(0);
  }
});

it("is idempotent — a second run writes nothing", async () => {
  await seedStarterSources(opts);
  const res2 = await seedStarterSources(opts);
  expect(res2.seeded).toEqual([]);
  expect(await listSources()).toHaveLength(STARTER_SOURCES.length);
});

it("does NOT resurrect a removed shelf", async () => {
  await seedStarterSources(opts);
  const [first] = await listSources();
  await deleteSourceRecord(first.id);
  await seedStarterSources(opts);
  const urls = (await listSources()).map((s) => s.url);
  expect(urls).not.toContain(first.url);
  expect(urls).toHaveLength(STARTER_SOURCES.length - 1);
});

it("makes NO network call during seeding", async () => {
  const spy = jest.spyOn(fetchFeedMod, "fetchFeed");
  await seedStarterSources(opts);
  expect(spy).not.toHaveBeenCalled();
  spy.mockRestore();
});

it("restore re-adds only the removed shelf, without clobbering kept ones", async () => {
  await seedStarterSources(opts);
  const before = await listSources();
  const kept = before.find((s) => s.url.includes("science"))!;
  const removed = before.find((s) => s.url.includes("history"))!;
  await deleteSourceRecord(removed.id);
  const res = await restoreStarterSources(opts);
  expect(res.seeded).toEqual([removed.url]);
  const after = await listSources();
  expect(after.map((s) => s.url).sort()).toEqual(STARTER_SOURCES.map((s) => s.url).sort());
  // the kept shelf's row is untouched (same id)
  expect(after.find((s) => s.url === kept.url)!.id).toBe(kept.id);
});
