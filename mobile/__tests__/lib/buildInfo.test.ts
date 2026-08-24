// Build-provenance stamp (device-verify: prove the running app == the built
// commit). buildInfo() reads version/versionCode from expo-constants (baked at
// build time) and sha from the babel-inlined EXPO_PUBLIC_GIT_SHA env var (same
// inlining mechanism as EXPO_PUBLIC_API_BASE_URL in src/api/client.ts).
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: "0.2.43",
      android: { versionCode: 55 },
    },
  },
}));

import Constants from "expo-constants";
import { buildInfo, buildLabel } from "@/lib/buildInfo";

describe("buildInfo", () => {
  const ORIGINAL_SHA = process.env.EXPO_PUBLIC_GIT_SHA;

  afterEach(() => {
    if (ORIGINAL_SHA === undefined) {
      delete process.env["EXPO_PUBLIC_GIT_SHA"];
    } else {
      process.env["EXPO_PUBLIC_GIT_SHA"] = ORIGINAL_SHA;
    }
  });

  it("reads version and versionCode from expo-constants", () => {
    const b = buildInfo();
    expect(b.version).toBe("0.2.43");
    expect(b.versionCode).toBe(55);
  });

  it("sha falls back to 'dev' when EXPO_PUBLIC_GIT_SHA is unset", () => {
    delete process.env["EXPO_PUBLIC_GIT_SHA"];
    expect(buildInfo().sha).toBe("dev");
  });

  it("sha reflects the baked value", () => {
    process.env["EXPO_PUBLIC_GIT_SHA"] = "a1b2c3d";
    expect(buildInfo().sha).toBe("a1b2c3d");
  });

  it("versionCode falls back to null when absent from expoConfig", () => {
    const original = Constants.expoConfig;
    (Constants as any).expoConfig = { version: "0.2.43" };
    expect(buildInfo().versionCode).toBeNull();
    (Constants as any).expoConfig = original;
  });

  it("version falls back to 'unknown' when expoConfig is absent", () => {
    const original = Constants.expoConfig;
    (Constants as any).expoConfig = null;
    expect(buildInfo().version).toBe("unknown");
    (Constants as any).expoConfig = original;
  });

  describe("buildLabel", () => {
    it("formats version, versionCode, and sha together", () => {
      process.env["EXPO_PUBLIC_GIT_SHA"] = "a1b2c3d";
      expect(buildLabel()).toBe("0.2.43 (vc55) · a1b2c3d");
    });

    it("omits the (vcN) clause when versionCode is null", () => {
      process.env["EXPO_PUBLIC_GIT_SHA"] = "a1b2c3d";
      const original = Constants.expoConfig;
      (Constants as any).expoConfig = { version: "0.2.43" };
      expect(buildLabel()).toBe("0.2.43 · a1b2c3d");
      (Constants as any).expoConfig = original;
    });
  });
});
