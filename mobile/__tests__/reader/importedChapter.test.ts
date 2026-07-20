import { renderChapterToHtml } from "@/reader/topicHtml";
import { buildChapterHtml, buildTopicHtml } from "@/components/contentHtml";
import type { GeneratedTopic, ImportedChapter } from "@/types/book";
import type { LessonOutput } from "@/types/lesson";
import { CHAPTER_SANITIZE_VECTORS, CHAPTER_KEEP_VECTORS } from "@/reader/chapterSanitizeVectors.fixtures";

// Minimal valid topic fixture, mirroring `__tests__/components/contentHtml.test.ts`'s
// own `topic()` helper — used only to pin that the CSP added to the chapter
// document (below) is NOT accidentally also added to the topic document, which
// legitimately fetches fonts/KaTeX/Mermaid from a CDN and would break under it.
const minimalLesson: LessonOutput = {
  topic: "A Topic",
  level: "Grade 11 reading level",
  language: "en",
  synopsis: "A short overview.",
  learning_objectives: ["Explain X"],
  sections: [{ heading: "Introduction", body_markdown: "Intro body." }],
  key_takeaways: ["takeaway one"],
  further_reading: [],
};

function minimalTopic(): GeneratedTopic {
  return {
    topicId: "t1",
    title: "A Topic",
    generatedAt: "2026-05-26T00:00:00Z",
    lesson: minimalLesson,
  };
}

// This file runs in the DEFAULT (node) jest environment, not `@jest-environment
// jsdom`: the deep tests below build their OWN jsdom window via `require("jsdom")`
// directly, rather than relying on ambient `document`/`window` globals. That
// package is already a real, relied-upon dependency of this repo (every
// `@jest-environment jsdom` docblock elsewhere — e.g. `sanitize.test.ts` —
// resolves through it), just used here explicitly instead of via a docblock.

function ch(html: string, images: Record<string, string> = {}): ImportedChapter {
  return { chapterId: "c1", title: "Letter 1", html, images, importedAt: "x" };
}

/** The decoded text of the `data:image/svg+xml` payload in the output's `<img src>`. */
function decodedSvgPayload(out: string): string {
  const m = /src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/.exec(out);
  expect(m).not.toBeNull();
  return Buffer.from(m![1], "base64").toString("utf8");
}

describe("renderChapterToHtml (shared, Hermes-safe)", () => {
  it("returns the chapter's own HTML as-is (no prepended title heading)", () => {
    // The title is shown in the screen's nav header, NOT prepended — otherwise it
    // double-prints against the EPUB's own chapter heading (a real render bug).
    const out = renderChapterToHtml(ch("<p>To Mrs Saville.</p>"));
    expect(out).toBe("<p>To Mrs Saville.</p>");
    expect(out).not.toContain("<h1>Letter 1</h1>");
  });

  it("does NOT run the markdown pipeline over it — it is already HTML", () => {
    const out = renderChapterToHtml(ch("<p>*not emphasis*</p>"));
    expect(out).toContain("*not emphasis*");
    expect(out).not.toContain("<em>");
  });

  it("is total: an empty chapter renders empty (title lives in the nav header)", () => {
    expect(renderChapterToHtml(ch(""))).toBe("");
  });

  it("never injects the untrusted title into the HTML (it's a nav-header Text)", () => {
    const evilTitleChapter = { ...ch("<p>Body</p>"), title: "<script>x</script>" };
    expect(renderChapterToHtml(evilTitleChapter)).not.toContain("<script>x</script>");
    expect(renderChapterToHtml(evilTitleChapter)).toBe("<p>Body</p>");
  });
});

describe("buildChapterHtml (the native WebView document)", () => {
  // Defense-in-depth behind DOMPurify: a chapter document needs ZERO network.
  // `img-src data:` alone kills every phone-home/tracking-pixel this whole
  // feature defends against, even one DOMPurify (or a future hook bug)
  // failed to catch. The topic doc (buildTopicHtml) carries its OWN, looser
  // CSP (#329 hardening) — it legitimately loads fonts/KaTeX/Mermaid from a
  // CDN, so its policy permits those hosts while the chapter doc locks the
  // network down entirely.
  it("declares a network-locked CSP ('default-src none'; img-src data: only)", () => {
    const doc = buildChapterHtml(ch("<p>Body</p>"));
    expect(doc).toContain(
      '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">',
    );
    // The topic doc ALSO has a CSP now (merged from #329), but a DIFFERENT,
    // CDN-permitting one — not the chapter's fully network-locked policy. Pin
    // that distinction: topic has a CSP that allows the render-dep CDN, chapter
    // does not.
    const topicDoc = buildTopicHtml(minimalTopic());
    expect(topicDoc).toContain("Content-Security-Policy");
    expect(topicDoc).toContain("cdn.jsdelivr.net");
    expect(topicDoc).not.toContain(
      'content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; script-src \'unsafe-inline\'">',
    );
  });

  it("inlines DOMPurify rather than fetching it — an imported book must open offline", () => {
    const doc = buildChapterHtml(ch("<p>Body</p>"));
    expect(doc).not.toContain("cdn.jsdelivr.net/npm/dompurify");
    expect(doc).not.toMatch(/https?:\/\/[^"]*dompurify/i);
    expect(doc).toContain("DOMPurify"); // the library itself is in the document
  });

  it("sanitizes BEFORE assigning innerHTML — never parse untrusted HTML unsanitized", () => {
    const doc = buildChapterHtml(ch("<p>Body</p>"));
    const sanitizeAt = doc.indexOf("DOMPurify.sanitize");
    const assignAt = doc.indexOf("innerHTML =");
    expect(sanitizeAt).toBeGreaterThan(-1);
    expect(sanitizeAt).toBeLessThan(assignAt);
  });

  it("escapes the embed so chapter content cannot break out of the script block", () => {
    // NOTE: this deliberately checks a narrower, ACTUALLY-TRUE property than a
    // literal reading of the brief's own version of this test
    // (`expect(doc).not.toContain("onerror=BREAKOUT")` against the whole
    // document). That stricter assertion cannot hold by this architecture's
    // own design: the raw chapter payload sits, inert, inside a JSON string
    // literal in the script block until DOMPurify runs on it AT RUNTIME
    // inside the WebView — jest never executes that script, so the static
    // `doc` string necessarily still contains "onerror=BREAKOUT" as JSON text
    // (harmless: it is JS-string data, not a live attribute, until sanitized
    // and assigned). Demanding its total absence from the static string would
    // only be satisfiable by scrubbing the payload at BUILD time in RN — the
    // exact regex-over-HTML anti-pattern Tasks 3-5 proved unsafe and this
    // task exists to replace. What actually matters, and IS asserted here:
    // (1) the breakout vector (GHSA-48wh-p7cx-c87j) is closed — `</script>`
    // cannot prematurely end the block; (2) the payload round-trips exactly,
    // proving the escaping didn't corrupt it into something else unsafe.
    const BREAKOUT = "</script><img src=x onerror=BREAKOUT>";
    const doc = buildChapterHtml(ch(`<p>Teaching HTML: ${BREAKOUT} is a closing tag.</p>`));
    const region = doc.slice(doc.indexOf("var DATA"), doc.indexOf("})();"));
    expect(region).not.toContain("</script>");
    expect(doc).not.toContain(BREAKOUT); // the COMBINED breakout string never survives intact

    const m = doc.match(/var DATA = (\{.*?\});\n/s);
    expect(m).not.toBeNull();
    const embedded = (JSON.parse(m![1]) as { __html: string }).__html;
    expect(embedded).toContain(BREAKOUT); // …but the content itself is preserved, inertly
  });

  it("ships no other network fetch for chapter documents (no fonts/KaTeX/Mermaid CDN)", () => {
    // Unlike buildTopicHtml, a chapter document has no reason to reach the
    // network at all — proving THIS is what makes "opens offline" true here,
    // not just "DOMPurify happens to be inlined". Scoped to actual
    // resource-loading tags/hosts (not "any http-like substring anywhere" —
    // DOMPurify's OWN minified source legitimately contains SVG/MathML
    // namespace URI string literals like "http://www.w3.org/2000/svg", which
    // are inert data, never a fetch).
    const doc = buildChapterHtml(ch("<p>Body</p>"));
    expect(doc).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(doc).not.toMatch(/<link[^>]*\shref=/i);
    expect(doc).not.toContain("fonts.googleapis.com");
    expect(doc).not.toContain("fonts.gstatic.com");
    expect(doc).not.toContain("cdn.jsdelivr.net");
  });
});

// ---------------------------------------------------------------------------
// The real thing: execute the ACTUAL generated document (real inlined
// DOMPurify + the real hook JS) inside a real DOM, exactly as the WebView
// would, and read back what actually reached `#root`. This is strictly
// stronger than asserting the JS source text — it proves the rendered code
// behaves, not just that it's shaped correctly.
import { JSDOM } from "jsdom";

function renderInWebView(chapter: ImportedChapter): string {
  const dom = new JSDOM(buildChapterHtml(chapter), { runScripts: "dangerously" });
  const root = dom.window.document.getElementById("root");
  if (!root) throw new Error("no #root in the generated document");
  return root.innerHTML;
}

describe("buildChapterHtml — executed for real (native path, table-driven)", () => {
  it.each(CHAPTER_SANITIZE_VECTORS.map((v) => [v.name, v] as const))(
    "%s",
    (_name, v) => {
      const out = renderInWebView(ch(v.html, v.images ?? {}));
      expect(out).not.toContain("evil.example");
      v.extra?.(out);
    },
  );

  it.each(CHAPTER_KEEP_VECTORS.map((v) => [v.name, v] as const))(
    "keeps benign content: %s",
    (_name, v) => {
      const out = renderInWebView(ch(v.html, v.images ?? {}));
      for (const needle of v.mustContain) expect(out).toContain(needle);
      for (const needle of v.decoded ?? []) expect(decodedSvgPayload(out)).toContain(needle);
    },
  );

  it("strips a script from an imported chapter, asserted over the parsed DOM", () => {
    const out = renderInWebView(
      ch('<p>Real</p><script>fetch("https://evil.example")</script><img src=x onerror="steal()">'),
    );
    const dom = new JSDOM(`<div>${out}</div>`);
    const el = dom.window.document.body.firstElementChild as HTMLElement;
    expect(el.querySelector("script")).toBeNull();
    expect(el.querySelector("img")).toBeNull(); // src="x" has no map entry → dropped whole
    expect(el.textContent).toContain("Real");
  });

  it("renders the chapter body in the WebView document (title is in the nav header)", () => {
    const out = renderInWebView(ch("<p>To Mrs Saville.</p>"));
    expect(out).toContain("<p>To Mrs Saville.</p>");
    expect(out).not.toContain("<h1>Letter 1</h1>");
  });
});
