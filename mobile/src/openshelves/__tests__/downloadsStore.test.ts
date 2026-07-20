import AsyncStorage from "@react-native-async-storage/async-storage";
import { listDownloads, getDownload, putDownload, deleteDownloadRecord, totalBytes, type DownloadRecord } from "../downloadsStore";

const rec = (entryId: string, bytes = 100): DownloadRecord => ({
  entryId, sourceId: "s1", title: entryId, path: `/x/${entryId}.epub`,
  mimeType: "application/epub+zip", bytes, downloadedAt: "T0",
});

beforeEach(async () => { await AsyncStorage.clear(); });

test("upsert by entryId, list, get, total", async () => {
  await putDownload(rec("a", 100));
  await putDownload(rec("b", 250));
  await putDownload(rec("a", 999)); // replace
  const all = await listDownloads();
  expect(all.map((d) => d.entryId)).toEqual(["a", "b"]);
  expect((await getDownload("a"))?.bytes).toBe(999);
  expect(totalBytes(all)).toBe(999 + 250);
  expect(await getDownload("missing")).toBeNull();
});

test("delete removes one record", async () => {
  await putDownload(rec("a"));
  await putDownload(rec("b"));
  await deleteDownloadRecord("a");
  expect((await listDownloads()).map((d) => d.entryId)).toEqual(["b"]);
});

test("corrupt blob → empty", async () => {
  await AsyncStorage.setItem("sbq_open_shelves_downloads", "nope");
  expect(await listDownloads()).toEqual([]);
});
