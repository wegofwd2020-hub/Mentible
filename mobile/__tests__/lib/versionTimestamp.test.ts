import { versionTimestamp } from "@/lib/versionTimestamp";

describe("versionTimestamp", () => {
  it("returns '' for null/invalid", () => {
    expect(versionTimestamp(null)).toBe("");
    expect(versionTimestamp("not-a-date")).toBe("");
  });
  it("returns a non-empty date+time string for a valid ISO", () => {
    const s = versionTimestamp("2026-08-04T14:14:00Z");
    expect(s.length).toBeGreaterThan(0);
    expect(s).not.toBe("");
  });
});
