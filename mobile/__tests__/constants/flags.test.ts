// FLAGS are inlined from EXPO_PUBLIC_FLAG_* at build time, so this test guards the
// default (no env var set) path: every flag must be off. The ON path is verified
// by setting the env var and building, since it cannot flip at runtime here.

import { FLAGS } from "@/constants/flags";

describe("FLAGS (default build)", () => {
  it("has no flag enabled when no EXPO_PUBLIC_FLAG_* env var is set", () => {
    for (const value of Object.values(FLAGS)) {
      expect(value).toBe(false);
    }
  });
});
