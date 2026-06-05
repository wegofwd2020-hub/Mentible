import { HELP_TOPICS, searchHelpTopics } from "../../src/constants/helpContent";

describe("searchHelpTopics", () => {
  it("returns all topics for an empty / whitespace query", () => {
    expect(searchHelpTopics("")).toHaveLength(HELP_TOPICS.length);
    expect(searchHelpTopics("   ")).toHaveLength(HELP_TOPICS.length);
  });

  it("is case-insensitive and matches visible text", () => {
    const ids = searchHelpTopics("OFFLINE").map((t) => t.id);
    expect(ids).toContain("troubleshooting");
  });

  it("matches the topic title", () => {
    expect(searchHelpTopics("glossary").map((t) => t.id)).toContain("glossary");
  });

  it("matches keywords that aren't in the visible prose", () => {
    // "billing" is a keyword on the BYOK topic but not in its body text.
    expect(searchHelpTopics("billing").map((t) => t.id)).toContain("byok");
  });

  it("returns nothing for an unrelated query", () => {
    expect(searchHelpTopics("xyzzy-not-a-term")).toHaveLength(0);
  });
});
