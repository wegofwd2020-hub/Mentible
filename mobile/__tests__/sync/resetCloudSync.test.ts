// resetCloudSync (ADR-014 lost-recovery-key recovery) end to end, with the REAL
// syncClient + syncEngine: only fetch and the local stores are mocked. The
// guarantees under test are the ORDER and the FAILURE behaviour:
//   - the server wipe happens first; the device's sync state is cleared only
//     after the server call succeeds, so a failed reset leaves the device
//     exactly as it was (its shadow still says "these books are synced");
//   - the reset never deletes local books, shelves or EPUBs;
//   - only the three sync keys are removed from AsyncStorage.

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.Mock;

jest.mock("expo-file-system", () => ({
  __esModule: true,
  cacheDirectory: "file:///cache/",
  deleteAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/sync/lmkStore", () => ({
  saveLMK: jest.fn(async () => {}),
  loadLMK: jest.fn(async () => null),
  clearLMK: jest.fn(async () => {}),
}));
jest.mock("@/storage/bookStore", () => ({
  loadBookIndex: jest.fn(async () => []),
  loadBook: jest.fn(async () => null),
  saveBook: jest.fn(async () => {}),
  deleteBook: jest.fn(async () => {}),
}));
jest.mock("@/storage/epubLibrary");
jest.mock("@/storage/shelfStore");

import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetCloudSync } from "@/sync/syncEngine";
import * as lmkStore from "@/sync/lmkStore";
import * as bookStore from "@/storage/bookStore";
import * as epubLibrary from "@/storage/epubLibrary";
import * as shelfStore from "@/storage/shelfStore";

const SHADOW = "sbq_sync_shadow";
const EPUB_SHADOW = "sbq_sync_epub_shadow";
const LAST_SYNCED = "sbq_sync_last_synced_at";
const UNRELATED = "sbq_theme_pref";

function okResponse() {
  return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
}
function errorResponse(status: number, body = "boom") {
  return { ok: false, status, json: async () => ({}), text: async () => body };
}

async function seedDeviceSyncState() {
  await AsyncStorage.setItem(SHADOW, JSON.stringify(["book-1", "book-2"]));
  await AsyncStorage.setItem(EPUB_SHADOW, JSON.stringify(["epub-1"]));
  await AsyncStorage.setItem(LAST_SYNCED, "2026-11-01T00:00:00Z");
  await AsyncStorage.setItem(UNRELATED, "dark");
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe("resetCloudSync", () => {
  it("calls the server wipe with the confirm phrase and the Bearer token", async () => {
    mockFetch.mockResolvedValueOnce(okResponse());

    await resetCloudSync("tok-123");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/sync/data?confirm=delete-all-synced-data");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual(expect.objectContaining({ Authorization: "Bearer tok-123" }));
  });

  it("wipes the server first, then clears the device key, then the sync state", async () => {
    await seedDeviceSyncState();
    mockFetch.mockResolvedValueOnce(okResponse());

    await resetCloudSync("tok");

    const serverOrder = mockFetch.mock.invocationCallOrder[0];
    const clearOrder = (lmkStore.clearLMK as jest.Mock).mock.invocationCallOrder[0];
    expect(serverOrder).toBeLessThan(clearOrder);
    expect(await AsyncStorage.getItem(SHADOW)).toBeNull();
    expect(await AsyncStorage.getItem(EPUB_SHADOW)).toBeNull();
    expect(await AsyncStorage.getItem(LAST_SYNCED)).toBeNull();
  });

  it("removes only the three sync keys and keeps unrelated AsyncStorage data", async () => {
    await seedDeviceSyncState();
    mockFetch.mockResolvedValueOnce(okResponse());

    await resetCloudSync("tok");

    expect(await AsyncStorage.getItem(UNRELATED)).toBe("dark");
  });

  it("never deletes local books, EPUBs or shelves", async () => {
    await seedDeviceSyncState();
    mockFetch.mockResolvedValueOnce(okResponse());

    await resetCloudSync("tok");

    expect(bookStore.deleteBook).not.toHaveBeenCalled();
    expect(bookStore.saveBook).not.toHaveBeenCalled();
    expect(epubLibrary.deleteEpub).not.toHaveBeenCalled();
    expect(epubLibrary.saveEpub).not.toHaveBeenCalled();
    expect(shelfStore.deleteShelf).not.toHaveBeenCalled();
    expect(shelfStore.pruneBook).not.toHaveBeenCalled();
  });

  it("a failed server wipe rejects and leaves the device state untouched", async () => {
    await seedDeviceSyncState();
    mockFetch.mockResolvedValueOnce(errorResponse(500, "server down"));

    await expect(resetCloudSync("tok")).rejects.toMatchObject({ status: 500 });

    // Nothing local was cleared: the device still holds its key and its shadow,
    // so a retry (or a later sync) sees the true state.
    expect(lmkStore.clearLMK).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SHADOW)).toBe(JSON.stringify(["book-1", "book-2"]));
    expect(await AsyncStorage.getItem(EPUB_SHADOW)).toBe(JSON.stringify(["epub-1"]));
    expect(await AsyncStorage.getItem(LAST_SYNCED)).toBe("2026-11-01T00:00:00Z");
  });

  it("a network failure rejects and leaves the device state untouched", async () => {
    await seedDeviceSyncState();
    mockFetch.mockRejectedValueOnce(new TypeError("Network request failed"));

    await expect(resetCloudSync("tok")).rejects.toThrow("Network request failed");

    expect(lmkStore.clearLMK).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(SHADOW)).not.toBeNull();
  });
});
