/**
 * @jest-environment jsdom
 */
// The WEB half of Task 6's guarantee: `sanitizeImportedChapterHtml` (and
// `renderChapterToSafeHtml`, which wraps it with the shared renderer) must
// close every vector in `chapterSanitizeVectors.ts`, and must NOT be so
// aggressive that it also breaks benign content (`CHAPTER_KEEP_VECTORS`).
//
// `@jest-environment jsdom` because DOMPurify needs a real DOM — same
// requirement as `sanitize.test.ts`.

import { sanitizeImportedChapterHtml } from "@/reader/sanitize";
import { renderChapterToSafeHtml } from "@/reader/renderContent";
import type { ImportedChapter } from "@/types/book";
import {
  CHAPTER_SANITIZE_VECTORS,
  CHAPTER_KEEP_VECTORS,
} from "@/reader/chapterSanitizeVectors.fixtures";

function ch(html: string, images: Record<string, string> = {}): ImportedChapter {
  return { chapterId: "c1", title: "Letter 1", html, images, importedAt: "x" };
}

describe("sanitizeImportedChapterHtml — the no-network guarantee (table-driven)", () => {
  it.each(CHAPTER_SANITIZE_VECTORS.map((v) => [v.name, v] as const))(
    "%s",
    (_name, v) => {
      const out = sanitizeImportedChapterHtml(v.html, v.images ?? {});
      // The bar this task exists for: no vector may leak evil.example into
      // the sanitized output.
      expect(out).not.toContain("evil.example");
      v.extra?.(out);
    },
  );

  it.each(CHAPTER_KEEP_VECTORS.map((v) => [v.name, v] as const))(
    "keeps benign content: %s",
    (_name, v) => {
      const out = sanitizeImportedChapterHtml(v.html, v.images ?? {});
      for (const needle of v.mustContain) expect(out).toContain(needle);
      for (const needle of v.decoded ?? []) {
        const m = /src="data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)"/.exec(out);
        expect(m).not.toBeNull();
        expect(Buffer.from(m![1], "base64").toString("utf8")).toContain(needle);
      }
    },
  );
});

describe("sanitizeImportedChapterHtml — hook lifecycle", () => {
  it("does not leak its hook onto later, unrelated sanitize calls", () => {
    // Regression guard: DOMPurify is a shared module singleton. If the chapter
    // hook were left attached, a LATER call to sanitize plain topic content
    // through the SAME DOMPurify instance would start silently dropping its
    // images too (this chapter's `images` map wouldn't even apply, so every
    // remote/unmapped src would vanish) — a real behavioural change to an
    // unrelated code path, not a hypothetical.
    sanitizeImportedChapterHtml('<img src="ok.png">', { "ok.png": "data:image/png;base64,AAA=" });

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DOMPurify = require("dompurify");
    const after = DOMPurify.sanitize('<img src="https://totally-unrelated.example/pic.png">', {
      USE_PROFILES: { html: true },
    }) as unknown as string;
    expect(after).toContain("https://totally-unrelated.example/pic.png");
  });
});

describe("renderChapterToSafeHtml — the full web boundary (render + sanitize)", () => {
  it("renders + sanitizes the body (title is in the nav header, not prepended)", () => {
    const out = renderChapterToSafeHtml(ch('<p>To Mrs Saville.</p>'));
    expect(out).toContain("<p>To Mrs Saville.</p>");
    expect(out).not.toContain("<h1>Letter 1</h1>");
  });

  it("closes the data-src decoy end to end", () => {
    const out = renderChapterToSafeHtml(
      ch('<img data-src="ok.png" src="https://evil.example/x">'),
    );
    expect(out).not.toContain("evil.example");
    expect(out).not.toContain("<img");
  });

  it("resolves a real chapter image end to end", () => {
    const out = renderChapterToSafeHtml(
      ch('<img src="images/fig1.png">', { "images/fig1.png": "data:image/png;base64,AAA=" }),
    );
    expect(out).toContain('src="data:image/png;base64,AAA=');
  });
});

describe("makeChapterSanitizeHook — SVG recursion depth cap", () => {
  it("refuses rather than infinitely recurses on a pathologically nested SVG-in-SVG", () => {
    // 6 levels of <image href="data:image/svg+xml;base64,..."> nesting, cap is 4.
    function nestSvg(n: number): string {
      if (n === 0) {
        return '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/leaf.png"/></svg>';
      }
      const inner = nestSvg(n - 1);
      const b64 = Buffer.from(inner, "utf8").toString("base64");
      return `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,${b64}"/></svg>`;
    }
    const deep = nestSvg(6);
    const b64 = Buffer.from(deep, "utf8").toString("base64");
    const html = `<img src="data:image/svg+xml;base64,${b64}">`;

    let out = "";
    expect(() => {
      out = sanitizeImportedChapterHtml(html, {});
    }).not.toThrow();

    // Recursively decode every nested data: URI the output still carries —
    // the leaf's evil.example must not survive at ANY depth, because the cap
    // drops the whole over-deep reference rather than passing it through raw.
    function assertNoEvilAtAnyDepth(s: string, depth: number): void {
      if (depth > 10) throw new Error("recursion did not terminate");
      expect(s).not.toContain("evil.example");
      const m = /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/.exec(s);
      if (m) assertNoEvilAtAnyDepth(Buffer.from(m[1], "base64").toString("utf8"), depth + 1);
    }
    assertNoEvilAtAnyDepth(out, 0);
  });
});
