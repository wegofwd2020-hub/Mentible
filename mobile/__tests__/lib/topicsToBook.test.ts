import { topicsToBook } from "@/lib/topicsToBook";
import type { StructuredTocView, DraftSection, ProjectInputView } from "@/api/trustClient";

const toc: StructuredTocView = {
  subjects: [
    { subject_label: "Music Theory", units: [{ id: "u1", title: "Notation", subtopics: [], prerequisites: [] }] },
    { subject_label: "Rhythm Basics", units: [{ id: "u2", title: "Timing", subtopics: [], prerequisites: [] }] },
  ],
};

const inputs: ProjectInputView[] = [
  { id: "i1", title: "Interview", content: "…", source_ref: null, kind: "transcript", created_at: null },
];

function sections(): Map<string, DraftSection[]> {
  return new Map([
    ["u1", [{ heading: "Staff", body: "5 lines", source_ids: ["i1"] }]],
    ["u2", [{ heading: "Rhythm", body: "beats", source_ids: [] }]],
  ]);
}

it("assembles per-topic drafts into a multi-topic Book with an aggregated Sources unit", () => {
  const book = topicsToBook("My Project", toc, sections(), inputs);

  expect(book.title).toBe("My Project");
  expect(book.toc.subjects[0].subject_label).toBe("Music Theory");
  expect(book.toc.subjects[0].units[0].id).toBe("u1");
  expect(book.toc.subjects[1].subject_label).toBe("Rhythm Basics");
  expect(book.toc.subjects[1].units[0].id).toBe("u2");

  expect(book.content!["u1"].lesson.sections).toEqual([
    { heading: "Staff", body_markdown: "5 lines", source_ids: ["i1"] },
  ]);
  expect(book.content!["u2"].lesson.sections).toEqual([
    { heading: "Rhythm", body_markdown: "beats", source_ids: [] },
  ]);

  const sourcesSubject = book.toc.subjects[book.toc.subjects.length - 1];
  expect(sourcesSubject.subject_label).toBe("Sources");
  expect(sourcesSubject.units).toHaveLength(1);
  const sourcesUnitId = sourcesSubject.units[0].id!;
  expect(sourcesSubject.units[0].title).toBe("Sources");
  const sourcesSection = book.content![sourcesUnitId].lesson.sections[0];
  expect(sourcesSection.heading).toBe("Sources");
  expect(sourcesSection.body_markdown).toContain("[S1] Interview");
});

it("carries svg and mermaid diagram fences into body_markdown verbatim (export survives assembly)", () => {
  const diagramBody = [
    "Here is a labeled diagram:",
    "",
    "```svg",
    '<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>',
    "```",
    "",
    "And a flow:",
    "",
    "```mermaid",
    "graph TD; A-->B;",
    "```",
  ].join("\n");
  const diagramSections: Map<string, DraftSection[]> = new Map([
    ["u1", [{ heading: "Staff", body: diagramBody, source_ids: [] }]],
    ["u2", [{ heading: "Rhythm", body: "beats", source_ids: [] }]],
  ]);

  const book = topicsToBook("My Project", toc, diagramSections, inputs);

  const bodyMarkdown = book.content!["u1"].lesson.sections[0].body_markdown;
  expect(bodyMarkdown).toContain(
    '```svg\n<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>\n```',
  );
  expect(bodyMarkdown).toContain("```mermaid\ngraph TD; A-->B;\n```");
  expect(bodyMarkdown).toBe(diagramBody);
});

it("omits the Sources unit entirely when nothing is cited", () => {
  const noCiteSections: Map<string, DraftSection[]> = new Map([
    ["u1", [{ heading: "Staff", body: "5 lines", source_ids: [] }]],
    ["u2", [{ heading: "Rhythm", body: "beats", source_ids: [] }]],
  ]);
  const book = topicsToBook("My Project", toc, noCiteSections, inputs);

  expect(book.toc.subjects).toHaveLength(2);
  expect(book.toc.subjects.some((s) => s.subject_label === "Sources")).toBe(false);
});
