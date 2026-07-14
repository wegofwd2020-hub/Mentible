import AsyncStorage from "@react-native-async-storage/async-storage";
import { getEntries, putEntries, deleteEntries } from "../feedEntriesStore";
import type { FeedEntry } from "../types";

const mk = (id: string): FeedEntry => ({
  id, title: "t", authors: [], summary: "", coverUrl: null, language: null,
  categories: [], mediaType: "book", rightsText: null, mature: null, links: [], canonicalUrl: null,
  navigationUrl: null,
});

beforeEach(async () => { await AsyncStorage.clear(); });

test("round-trips entries per source", async () => {
  await putEntries("s1", [mk("a"), mk("b")]);
  expect((await getEntries("s1")).map((e) => e.id)).toEqual(["a", "b"]);
  expect(await getEntries("s2")).toEqual([]); // untouched source
});

test("delete removes only that source's entries", async () => {
  await putEntries("s1", [mk("a")]);
  await putEntries("s2", [mk("b")]);
  await deleteEntries("s1");
  expect(await getEntries("s1")).toEqual([]);
  expect((await getEntries("s2")).map((e) => e.id)).toEqual(["b"]);
});

test("corrupt blob reads back as empty, never throws", async () => {
  await AsyncStorage.setItem("sbq_feed_entries_s1", "{not json");
  expect(await getEntries("s1")).toEqual([]);
});

test("legacy stored entry missing navigationUrl normalizes to null", async () => {
  // Simulates data persisted before navigationUrl existed on FeedEntry: the key
  // is entirely absent from the JSON, so a naive JSON.parse cast would leave it
  // `undefined`, not `null` (spec: old entries must read as null).
  const legacyEntry = {
    id: "legacy-1",
    title: "t",
    authors: [],
    summary: "",
    coverUrl: null,
    language: null,
    categories: [],
    mediaType: "book",
    rightsText: null,
    mature: null,
    links: [],
    canonicalUrl: null,
    // navigationUrl intentionally absent
  };
  await AsyncStorage.setItem("sbq_feed_entries_s1", JSON.stringify([legacyEntry]));
  const entries = await getEntries("s1");
  expect(entries).toHaveLength(1);
  expect(entries[0].navigationUrl).toBeNull();
});
