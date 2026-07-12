import AsyncStorage from "@react-native-async-storage/async-storage";
import { addSource } from "../feedStore";
import { listSources } from "../feedSourcesStore";
import { getEntries } from "../feedEntriesStore";
import { FeedSourceError } from "../errors";

const OPDS = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Lib</title>
  <entry><id>e1</id><title>Book One</title>
    <link rel="http://opds-spec.org/acquisition" href="https://ex.org/1.epub" type="application/epub+zip"/>
  </entry>
  <entry><id>e2</id><title>Book Two</title></entry>
</feed>`;

const ok = async () =>
  ({ ok: true, status: 200, headers: { get: () => null }, text: async () => OPDS } as unknown as Response);

const fixedOpts = { fetchImpl: ok as any, now: () => "2026-07-12T00:00:00Z", newId: () => "src-1" };

beforeEach(async () => { await AsyncStorage.clear(); });

test("adds a source and persists its entries", async () => {
  const src = await addSource("https://ex.org/feed", fixedOpts);
  expect(src).toMatchObject({ id: "src-1", url: "https://ex.org/feed", title: "Lib", isStarter: false, entryCount: 2, lastRefreshedAt: "2026-07-12T00:00:00Z" });
  expect((await listSources()).map((s) => s.id)).toEqual(["src-1"]);
  expect((await getEntries("src-1")).map((e) => e.id)).toEqual(["e1", "e2"]);
});

test("a non-https URL throws and persists nothing", async () => {
  await expect(addSource("http://ex.org/feed", fixedOpts)).rejects.toBeInstanceOf(FeedSourceError);
  expect(await listSources()).toEqual([]);
  expect(await getEntries("src-1")).toEqual([]);
});

test("an unreachable feed throws and persists nothing", async () => {
  const boom = async () => { throw new Error("network down"); };
  await expect(addSource("https://ex.org/feed", { ...fixedOpts, fetchImpl: boom as any })).rejects.toBeInstanceOf(FeedSourceError);
  expect(await listSources()).toEqual([]);
});
