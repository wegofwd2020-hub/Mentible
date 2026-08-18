import { HELP_TOPICS } from "@/help-content";

describe("help content — nav-hidden Shelves cluster is not documented", () => {
  it("does not include the dropped Shelves-cluster topics", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).not.toContain("open-shelves");
    expect(ids).not.toContain("imported-books");
    expect(ids).not.toContain("chapter-quiz");
  });
});

describe("help content — stale 'Studio' nav copy is fixed", () => {
  it("reading-a-book does not name Studio as a live nav tab or say 'five places'", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "reading-a-book")!;
    const text = topic.blocks
      .map((b) => ("text" in b ? b.text : ""))
      .join(" ");
    expect(text).not.toMatch(/Studio \(create and edit books\)/);
    expect(text).not.toMatch(/five places/);
  });

  it("share-a-draft does not point reviewers at a Studio badge", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "share-a-draft")!;
    const steps = topic.blocks.flatMap((b) => ("steps" in b ? b.steps : []));
    expect(steps.join(" ")).not.toMatch(/badge appears on the book in Studio/);
  });
});

describe("help content — Projects subtree has the three new tab topics", () => {
  it("includes project-structure, project-drafts and project-publish", () => {
    const ids = HELP_TOPICS.map((t) => t.id);
    expect(ids).toEqual(
      expect.arrayContaining(["project-structure", "project-drafts", "project-publish"]),
    );
  });
});

describe("help content — Projects subtree accuracy fixes", () => {
  it("sources does not claim Title/Label is required to enable Add source", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "sources")!;
    const text = topic.blocks
      .map((b) => ("text" in b ? b.text : "steps" in b ? b.steps.join(" ") : ""))
      .join(" ");
    expect(text).not.toMatch(/both fields/);
    expect(text).toMatch(/optional/);
  });

  it("draft-viewer does not claim invited Editors can Revise\\/regenerate", () => {
    const topic = HELP_TOPICS.find((t) => t.id === "draft-viewer")!;
    const text = topic.blocks
      .map((b) => ("text" in b ? b.text : ""))
      .join(" ");
    expect(text).not.toMatch(/Owners \(and invited Editors\) can also edit or regenerate/);
    expect(text).toMatch(/that's owner-only/);
  });
});
