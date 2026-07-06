import { blockText, searchHelpTopics, uncoveredFeatures, type HelpTopic } from "@/help";

const topics: HelpTopic[] = [
  { id: "a", title: "Reading", keywords: ["scroll"], blocks: [{ kind: "text", text: "open a book" }], featureKey: "reading" },
  { id: "b", title: "Glossary", keywords: [], blocks: [{ kind: "defs", defs: [{ term: "BYOK", def: "bring your own key" }] }] },
];

it("blockText flattens visible text", () => {
  expect(blockText(topics[0].blocks)).toBe("open a book");
  expect(blockText(topics[1].blocks)).toContain("BYOK");
});

it("searchHelpTopics matches title, keyword, and block text (case-insensitive)", () => {
  expect(searchHelpTopics("reading", topics).map((t) => t.id)).toEqual(["a"]);
  expect(searchHelpTopics("SCROLL", topics).map((t) => t.id)).toEqual(["a"]);
  expect(searchHelpTopics("byok", topics).map((t) => t.id)).toEqual(["b"]);
  expect(searchHelpTopics("", topics)).toHaveLength(2); // empty query → all
});

it("uncoveredFeatures reports features with no covering topic", () => {
  expect(uncoveredFeatures([{ key: "reading" }, { key: "sharing" }], topics)).toEqual(["sharing"]);
});
