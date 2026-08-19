import { renderTopicToHtml } from "@/reader/topicHtml";
import type { GeneratedTopic } from "@/types/book";

const topic: GeneratedTopic = {
  topicId: "u1", title: "T", generatedAt: "2026-08-19T00:00:00.000Z",
  lesson: { topic: "T", level: "intro", language: "en", synopsis: "s", learning_objectives: [], sections: [{ heading: "H", body_markdown: "b" }], key_takeaways: [], further_reading: [] },
  audio: [{ id: "a1", file: "media/b/a1.mp3", mime: "audio/mpeg", title: "Intro", transcript: "Hi." }],
};

it("web target embeds the <audio> player when a data url is supplied", () => {
  const html = renderTopicToHtml(topic, undefined, { audioTarget: "web", audioUrls: new Map([["a1", "data:audio/mpeg;base64,AAA="]]) });
  expect(html).toContain('<audio class="rd-audio" controls="controls"');
});

it("native target embeds the id-keyed control, no <audio>", () => {
  const html = renderTopicToHtml(topic, undefined, { audioTarget: "native" });
  expect(html).toContain('class="rd-audio-toggle" data-audio-id="a1"');
  expect(html).not.toContain("<audio");
});

it("no opts → no audio block (unchanged legacy behavior)", () => {
  const html = renderTopicToHtml(topic);
  expect(html).not.toContain("rd-audio");
  expect(html).not.toContain('section class="audio"');
});
