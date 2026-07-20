import "fake-indexeddb/auto";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { putBookValue, getBookValue, delBookValue } from "@/storage/bookBlobStore";

const big = "x".repeat(6 * 1024 * 1024); // 6 MB — over the ~5 MB localStorage ceiling

describe("bookBlobStore", () => {
  afterEach(async () => { await AsyncStorage.clear(); });

  it("web: round-trips a >5 MB value through IndexedDB (no quota error)", async () => {
    Platform.OS = "web";
    await putBookValue("bk-1", big);
    // DISCRIMINATES the web branch: the value must NOT be in AsyncStorage — if it
    // were, the native path ran (e.g. `isWeb` frozen at module load) and this test
    // would silently validate AsyncStorage instead of IndexedDB.
    expect(await AsyncStorage.getItem("sbq_book_bk-1")).toBeNull();
    expect(await getBookValue("bk-1")).toBe(big);
    await delBookValue("bk-1");
    expect(await getBookValue("bk-1")).toBeNull();
  });

  it("web: getBookValue returns null for a missing id", async () => {
    Platform.OS = "web";
    expect(await getBookValue("nope")).toBeNull();
  });

  it("native: uses AsyncStorage at sbq_book_<id>", async () => {
    Platform.OS = "ios";
    await putBookValue("bk-2", "hello");
    expect(await AsyncStorage.getItem("sbq_book_bk-2")).toBe("hello");
    expect(await getBookValue("bk-2")).toBe("hello");
    await delBookValue("bk-2");
    expect(await AsyncStorage.getItem("sbq_book_bk-2")).toBeNull();
  });
});
