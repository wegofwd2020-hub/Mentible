import { lessonToNarratableText } from "@/lib/lessonToNarratableText";

const lesson: any = {
  topic: "Energy", synopsis: "Energy is the capacity to do work.",
  sections: [{ heading: "Kinetic", body_markdown: "Motion energy: **½mv²**." }, { heading: "Potential", body_markdown: "Stored energy." }],
  key_takeaways: ["Energy is conserved."],
};

it("concatenates synopsis + section bodies + takeaways into plain text", () => {
  const t = lessonToNarratableText(lesson);
  expect(t).toContain("Energy is the capacity to do work.");
  expect(t).toContain("Motion energy"); // section body included
  expect(t).toContain("Stored energy.");
  expect(t).toContain("Energy is conserved."); // takeaway
});

it("is non-empty for a minimal lesson and trims", () => {
  expect(lessonToNarratableText({ synopsis: "S", sections: [], key_takeaways: [] } as any)).toBe("S");
});

it("tolerates missing arrays", () => {
  expect(() => lessonToNarratableText({ synopsis: "" } as any)).not.toThrow();
});
