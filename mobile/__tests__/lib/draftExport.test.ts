import { sectionsToPlainText, sectionsToMarkdown } from "@/lib/draftExport";

const secs = [
  { heading: "Enrollment", body: "Sign up during IEP.", source_ids: [] },
  { heading: "Costs", body: "Premiums vary.", source_ids: [] },
];

it("plain text joins heading and body per section, blank line between", () => {
  expect(sectionsToPlainText(secs)).toBe("Enrollment\n\nSign up during IEP.\n\nCosts\n\nPremiums vary.");
});

it("plain text prepends an optional title", () => {
  expect(sectionsToPlainText(secs, "Medicare")).toBe(
    "Medicare\n\nEnrollment\n\nSign up during IEP.\n\nCosts\n\nPremiums vary.",
  );
});

it("markdown uses ## per section and # for the title", () => {
  expect(sectionsToMarkdown(secs, "Medicare")).toBe(
    "# Medicare\n\n## Enrollment\n\nSign up during IEP.\n\n## Costs\n\nPremiums vary.",
  );
});

it("drops an empty heading or body instead of leaving a dangling separator", () => {
  expect(sectionsToPlainText([{ heading: "", body: "Body only.", source_ids: [] }])).toBe("Body only.");
  expect(sectionsToMarkdown([{ heading: "Head only.", body: "", source_ids: [] }])).toBe("## Head only.");
});

it("handles undefined/empty input", () => {
  expect(sectionsToPlainText(undefined)).toBe("");
  expect(sectionsToMarkdown([], "T")).toBe("# T");
});
