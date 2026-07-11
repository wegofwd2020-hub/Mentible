import { searchHelpTopics, blockText } from "@/help";
import { HELP_TOPICS } from "@/help-content";

const readingTopic = HELP_TOPICS.find((t) => t.id === "reading-a-book")!;

it("documents the interactive quiz in the reading-a-book topic", () => {
  const text = blockText(readingTopic.blocks).toLowerCase();
  expect(text).toContain("quiz");
  expect(text).toMatch(/tap|interactive/);
  expect(text).toContain("explanation");
});

it('searching "quiz" surfaces the reading-a-book topic', () => {
  const ids = searchHelpTopics("quiz", HELP_TOPICS).map((t) => t.id);
  expect(ids).toContain("reading-a-book");
});
