// Executes the REAL native topic document (buildTopicHtml output) the way the
// WebView does — runScripts:"dangerously" runs the inlined DOMPurify + hook +
// the innerHTML assignment — then reads back #root. Mirrors F1's chapter native
// test. This proves the shipped WebView doc sanitizes, not a mock.
//
// Deliberately NOT run under `@jest-environment jsdom`: that environment
// replaces `globalThis` with a jsdom window that has no `TextEncoder`, which
// crashes `jsdom`'s own `whatwg-url` dependency at import time. The default
// (react-native) test environment keeps Node's real global, which has
// `TextEncoder` natively — so a `jsdom` package instance is built explicitly
// below instead, exactly as the F1 chapter native test does.
import { JSDOM } from "jsdom";
import { buildTopicHtml } from "@/components/contentHtml";
import { ATTACK_VECTORS, KEEP_VECTORS } from "@/reader/topicSanitizeVectors.fixtures";
import type { GeneratedTopic } from "@/types/book";

function topicWith(bodyHtml: string): GeneratedTopic {
  return {
    id: "t", label: "x", detail: "d",
    lesson: { title: "x", sections: [{ heading: "S", body_markdown: `intro\n\n${bodyHtml}` }] },
  } as unknown as GeneratedTopic;
}

// Render the doc, strip the CDN <script src> tags (offline in jest — KaTeX/Mermaid
// are absent and optional), run the rest, return #root.innerHTML.
function renderRoot(html: string): string {
  // Strip the CDN <script src> tags (they carry crossorigin=, so match any attrs
  // after the src). jsdom does not fetch them anyway; this just keeps the executed
  // doc free of KaTeX/Mermaid globals so the assertions read only our sanitizer.
  const doc = html.replace(/<script src="https:[^"]*"[^>]*><\/script>/g, "");
  const dom = new JSDOM(doc, { runScripts: "dangerously" });
  return dom.window.document.getElementById("root")?.innerHTML ?? "";
}

describe("native topic WebView document", () => {
  it("has the topic CSP meta, scoped to CDNs + connect-src none", () => {
    const out = buildTopicHtml(topicWith("<p>x</p>"));
    expect(out).toContain(`http-equiv="Content-Security-Policy"`);
    expect(out).toContain("connect-src 'none'");
    expect(out).toContain("img-src data:");
    expect(out).toContain("https://cdn.jsdelivr.net");
  });

  it.each(ATTACK_VECTORS.map((v) => [v.name, v] as const))(
    "sanitizes before innerHTML — drops: %s",
    (_n, v) => {
      const root = renderRoot(buildTopicHtml(topicWith(v.html)));
      expect(v.leaks(root)).toBe(false);
    },
  );

  it.each(KEEP_VECTORS.map((v) => [v.name, v] as const))(
    "preserves legit content: %s",
    (_n, v) => {
      const root = renderRoot(buildTopicHtml(topicWith(v.html)));
      expect(v.survives(root)).toBe(true);
    },
  );
});
