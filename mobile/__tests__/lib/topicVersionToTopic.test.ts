import { topicVersionToTopic, versionToTopic } from "@/lib/topicVersionToTopic";
import type { TopicVersionDetailView, VersionDetailView } from "@/api/trustClient";

function tv(overrides: Partial<TopicVersionDetailView> = {}): TopicVersionDetailView {
  return {
    id: "tv1",
    topic_id: "t1",
    title: "Reading music",
    content: {
      sections: [
        { heading: "Staff", body: "5 lines", source_ids: [] },
        { heading: "Notes", body: "Pitch and duration", source_ids: ["s1"] },
      ],
    },
    version_no: 2,
    created_at: "2026-08-09T00:00:00Z",
    is_validated: false,
    recorded_via: null,
    ...overrides,
  };
}

it("maps a TopicVersionDetailView onto the GeneratedTopic lesson shape", () => {
  const topic = topicVersionToTopic(tv());

  expect(topic.topicId).toBe("tv1");
  expect(topic.title).toBe("Reading music");
  expect(topic.generatedAt).toBe("2026-08-09T00:00:00Z");
  expect(topic.lesson.topic).toBe("Reading music");
  expect(topic.lesson.sections).toEqual([
    { heading: "Staff", body_markdown: "5 lines" },
    { heading: "Notes", body_markdown: "Pitch and duration" },
  ]);
  // Fields the draft doesn't carry stay empty, matching topicsToBook/artifactToBook.
  expect(topic.lesson.synopsis).toBe("");
  expect(topic.lesson.learning_objectives).toEqual([]);
  expect(topic.lesson.key_takeaways).toEqual([]);
  expect(topic.lesson.further_reading).toEqual([]);
});

it("falls back to an empty string when created_at is null", () => {
  const topic = topicVersionToTopic(tv({ created_at: null }));
  expect(topic.generatedAt).toBe("");
});

it("maps zero sections to an empty lesson.sections array", () => {
  const topic = topicVersionToTopic(tv({ content: { sections: [] } }));
  expect(topic.lesson.sections).toEqual([]);
});

function version(overrides: Partial<VersionDetailView> = {}): VersionDetailView {
  return {
    id: "v1",
    artifact_id: "a1",
    version_no: 1,
    content: {
      sections: [
        {
          heading: "H",
          body: "```mermaid\nflowchart TD\n A-->B\n```",
          source_ids: [],
        },
      ],
    },
    generation_meta: null,
    is_validated: false,
    recorded_via: null,
    created_at: "",
    feedback: [],
    ...overrides,
  };
}

it("maps a whole-book draft VersionDetailView onto the GeneratedTopic lesson shape, body verbatim", () => {
  const topic = versionToTopic(version());

  expect(topic.topicId).toBe("v1");
  expect(topic.title).toBe("");
  expect(topic.lesson.topic).toBe("");
  expect(topic.lesson.sections[0].body_markdown).toBe("```mermaid\nflowchart TD\n A-->B\n```");
  expect(topic.lesson.sections).toEqual([
    { heading: "H", body_markdown: "```mermaid\nflowchart TD\n A-->B\n```" },
  ]);
});

it("versionToTopic falls back to an empty string when created_at is null", () => {
  const topic = versionToTopic(version({ created_at: null }));
  expect(topic.generatedAt).toBe("");
});
