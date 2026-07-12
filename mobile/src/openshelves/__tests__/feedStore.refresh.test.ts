import AsyncStorage from "@react-native-async-storage/async-storage";
import { addSource, refreshSource, refreshAll, removeSource } from "../feedStore";
import { listSources, getSource } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { FeedRefreshError } from "../errors";

const feed = (entries: string) =>
  `<feed xmlns="http://www.w3.org/2005/Atom"><title>Lib</title>${entries}</feed>`;
const e = (id: string) => `<entry><id>${id}</id><title>t</title></entry>`;
const resp = (xml: string) => async (_u?: string) =>
  ({ ok: true, status: 200, headers: { get: () => null }, text: async () => xml } as unknown as Response);

const addOpts = (xml: string) => ({ fetchImpl: resp(xml) as any, now: () => "T0", newId: () => "s1" });

beforeEach(async () => { await AsyncStorage.clear(); });

test("refresh upserts new and prunes removed, updates count + timestamp", async () => {
  await addSource("https://ex.org/f", addOpts(feed(e("a") + e("b"))));
  const r = await refreshSource("s1", { fetchImpl: resp(feed(e("a") + e("c"))) as any, now: () => "T1" });
  expect(r).toEqual({ added: 1, updated: 0, removed: 1 }); // +c, -b
  expect((await getEntries("s1")).map((x) => x.id)).toEqual(["a", "c"]);
  const s = await getSource("s1");
  expect(s?.entryCount).toBe(2);
  expect(s?.lastRefreshedAt).toBe("T1");
});

test("a failed refresh leaves the previous catalog intact (P0-4)", async () => {
  await addSource("https://ex.org/f", addOpts(feed(e("a") + e("b"))));
  const boom = async () => { throw new Error("network down"); };
  await expect(refreshSource("s1", { fetchImpl: boom as any })).rejects.toThrow();
  expect((await getEntries("s1")).map((x) => x.id)).toEqual(["a", "b"]); // unchanged
  expect((await getSource("s1"))?.lastRefreshedAt).toBe("T0"); // unchanged
});

test("refreshSource on unknown id throws FeedRefreshError", async () => {
  await expect(refreshSource("nope")).rejects.toBeInstanceOf(FeedRefreshError);
});

test("removeSource deletes the record and its entries", async () => {
  await addSource("https://ex.org/f", addOpts(feed(e("a"))));
  await removeSource("s1");
  expect(await listSources()).toEqual([]);
  expect(await getEntries("s1")).toEqual([]);
});

test("refreshAll refreshes each source and isolates failures", async () => {
  await addSource("https://ex.org/f1", { fetchImpl: resp(feed(e("a"))) as any, now: () => "T0", newId: () => "s1" });
  await addSource("https://ex.org/f2", { fetchImpl: resp(feed(e("b"))) as any, now: () => "T0", newId: () => "s2" });
  const boom = async (u: string) => (String(u).includes("f2") ? (() => { throw new Error("x"); })() : resp(feed(e("a") + e("z")))(u));
  const out = await refreshAll({ fetchImpl: boom as any, now: () => "T1" });
  expect(out["s1"]).toEqual({ added: 1, updated: 0, removed: 0 }); // +z
  expect("error" in (out["s2"] as any)).toBe(true); // f2 failed, isolated
  // P0-4 for the failed member of the batch: s2's previous catalog is intact.
  expect((await getEntries("s2")).map((x) => x.id)).toEqual(["b"]);
});

test("refresh counts a changed entry as updated and persists the new version", async () => {
  // First fetch: entry "a" with title "Old".
  const v1 = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Lib</title><entry><id>a</id><title>Old</title></entry></feed>`;
  const v2 = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Lib</title><entry><id>a</id><title>New</title></entry></feed>`;
  await addSource("https://ex.org/f", { fetchImpl: resp(v1) as any, now: () => "T0", newId: () => "s1" });
  const r = await refreshSource("s1", { fetchImpl: resp(v2) as any, now: () => "T1" });
  expect(r).toEqual({ added: 0, updated: 1, removed: 0 });
  expect((await getEntries("s1"))[0].title).toBe("New");
});
