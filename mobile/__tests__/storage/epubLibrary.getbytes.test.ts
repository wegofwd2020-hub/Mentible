// Exercises getEpubBytes() on the web (IndexedDB) path.
//
// epubLibrary.ts captures `isWeb` ONCE at module load (`const isWeb =
// Platform.OS === "web"`), unlike bookBlobStore.ts's per-call check — so the
// usual "mutate Platform.OS inside an it()" pattern doesn't flip its branch.
// Instead: mutate Platform.OS first, then `require()` the module (a plain
// call, not hoisted like `import`), so the module evaluates with OS "web"
// already in place. jest-expo defaults Platform.OS to "ios"; this file's
// module registry is isolated from other test files, so this doesn't affect
// the native-path coverage in epubLibrary.test.ts.
import "fake-indexeddb/auto";
import { Platform } from "react-native";

Platform.OS = "web";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { saveEpub, getEpubBytes } = require("@/storage/epubLibrary") as typeof import("@/storage/epubLibrary");

it("getEpubBytes returns the stored bytes for a saved epub, null for a missing id", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4, 5]).buffer;
  await saveEpub({ bookId: "b1", title: "T", bytes });
  const out = await getEpubBytes("b1");
  expect(out).not.toBeNull();
  expect(new Uint8Array(out!)).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  expect(await getEpubBytes("nope")).toBeNull();
});
