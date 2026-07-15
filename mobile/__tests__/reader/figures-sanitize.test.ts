/** @jest-environment jsdom */
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import type { GeneratedTopic } from "@/types/book";

const topic: GeneratedTopic = {
  topicId: "t", title: "T",
  lesson: { topic: "T", synopsis: "s", learning_objectives: [], sections: [], key_takeaways: [] } as any,
  images: [{ id: "a", file: "media/b/a.png", mime: "image/png", caption: "Cap", addedAt: "x" }],
  generatedAt: "x",
};

describe("figures survive sanitize with a data: src", () => {
  it("keeps the data: URL and never emits a remote src", () => {
    const html = renderTopicToSafeHtml(topic, new Map([["a", "data:image/png;base64,iVBORw0KGgo="]]));
    const doc = new DOMParser().parseFromString(html, "text/html");
    const imgs = [...doc.querySelectorAll("img")];
    expect(imgs).toHaveLength(1);
    for (const el of imgs) expect(el.getAttribute("src")!).toMatch(/^data:image\//);
    expect(html).not.toMatch(/https?:\/\//);
  });
});
