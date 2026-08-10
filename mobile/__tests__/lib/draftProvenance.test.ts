import { describeProvenance } from "@/lib/draftProvenance";

it("summarizes sources and guidance", () => {
  expect(describeProvenance({ source_input_ids: ["a", "b", "c"] })).toContain("3 sources");
  const g = describeProvenance({ source_input_ids: ["a"], guidance: "focus on X" });
  expect(g).toContain("1 source");
  expect(g).toContain("with your guidance");
});

it("never throws on null / empty / malformed meta", () => {
  expect(typeof describeProvenance(null)).toBe("string");
  expect(typeof describeProvenance({})).toBe("string");
  expect(typeof describeProvenance({ source_input_ids: "nope" as unknown as string[] })).toBe("string");
});
