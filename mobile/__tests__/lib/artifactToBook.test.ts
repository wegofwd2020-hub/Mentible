import { artifactToBook } from "@/lib/artifactToBook";

const inputs = [
  { id: "i1", kind: "transcript", title: "Interview 07-20", content: "…", source_ref: null, created_at: null },
  { id: "i2", kind: "link", title: null, content: "medicare.gov enrollment", source_ref: "https://medicare.gov", created_at: null },
];

it("maps sections to lesson body_markdown and appends a Sources section for cited inputs", () => {
  const book = artifactToBook(
    [{ heading: "Windows", body: "Sign up during IEP.", source_ids: ["i1"] },
     { heading: "Cost", body: "Premiums vary.", source_ids: ["i2"] }],
    "Medicare guide",
    inputs as any,
  );
  expect(book.title).toBe("Medicare guide");
  const topicId = Object.keys(book.content!)[0];
  const secs = book.content![topicId].lesson.sections;
  expect(secs[0]).toEqual({ heading: "Windows", body_markdown: "Sign up during IEP.", source_ids: ["i1"] });
  const sources = secs[secs.length - 1];
  expect(sources.heading).toBe("Sources");
  expect(sources.body_markdown).toContain("[S1] Interview 07-20");
  expect(sources.body_markdown).toContain("[S2]");            // i2: no title → source_ref/content
  // toc wires the same topic id
  expect(book.toc.subjects[0].units[0].id).toBe(topicId);
});

it("omits the Sources section when nothing is cited, and defaults an empty title", () => {
  const book = artifactToBook([{ heading: "H", body: "B", source_ids: [] }], "   ", []);
  expect(book.title).toBe("Untitled");
  const topicId = Object.keys(book.content!)[0];
  const secs = book.content![topicId].lesson.sections;
  expect(secs).toHaveLength(1);
  expect(secs.some((s) => s.heading === "Sources")).toBe(false);
});

it("threads an optional metadata param onto the returned Book unchanged", () => {
  const book = artifactToBook(
    [{ heading: "H", body: "B", source_ids: [] }], "Title", [],
    { rights: "© 2026 Jane Doe. All rights reserved." },
  );
  expect(book.metadata).toEqual({ rights: "© 2026 Jane Doe. All rights reserved." });
});

it("leaves metadata undefined when none is passed (default export behavior unchanged)", () => {
  const book = artifactToBook([{ heading: "H", body: "B", source_ids: [] }], "Title", []);
  expect(book.metadata).toBeUndefined();
});
