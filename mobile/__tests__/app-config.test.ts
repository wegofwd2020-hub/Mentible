// Regression guard for the native EPUB-crypto build wiring (Inc 2.1, Task 9).
//
// `expo-build-properties` sets the Android `minSdkVersion` floor required by
// `react-native-aes-gcm-crypto` (needs 26+). This is config, not code — the
// only way to catch an accidental revert (e.g. a merge conflict resolved
// against an older app.json) is to assert on the parsed file directly.
import appConfig from "../app.json";

describe("app.json build config", () => {
  it("declares the expo-build-properties plugin with Android minSdkVersion 26", () => {
    const plugins = appConfig.expo.plugins as unknown[];
    expect(Array.isArray(plugins)).toBe(true);

    const entry = plugins.find(
      (p) => Array.isArray(p) && p[0] === "expo-build-properties",
    ) as [string, { android?: { minSdkVersion?: number } }] | undefined;

    expect(entry).toBeDefined();
    expect(entry?.[1]?.android?.minSdkVersion).toBe(26);
  });
});
