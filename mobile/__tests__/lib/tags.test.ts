import { parseTags, formatTags } from "@/lib/tags";

describe("parseTags", () => {
  it("splits a comma list and trims each tag", () => {
    expect(parseTags("math, physics ,  chemistry")).toEqual(["math", "physics", "chemistry"]);
  });
  it("drops empties; all-empty/blank → undefined", () => {
    expect(parseTags("  ,  , ")).toBeUndefined();
    expect(parseTags("")).toBeUndefined();
  });
  it("de-dupes case-insensitively, keeping the first spelling", () => {
    expect(parseTags("Math, math, MATH, algebra")).toEqual(["Math", "algebra"]);
  });
});

describe("formatTags", () => {
  it("joins with comma-space; undefined → empty string", () => {
    expect(formatTags(["a", "b"])).toBe("a, b");
    expect(formatTags(undefined)).toBe("");
  });
});
