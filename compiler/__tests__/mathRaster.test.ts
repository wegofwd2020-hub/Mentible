import {
  collectMathHtml,
  rasterizeMath,
  replaceMathWithImages,
} from "../src/mathRaster";
import type { Book, LessonOutput } from "../src/types";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPngResilient: jest.fn(async (svgs: string[]) => svgs.map((_, i) => Buffer.from(`png-${i}`))),
}));

const KATEX_INLINE =
  '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics><mrow><mi>v</mi></mrow>' +
  '<annotation encoding="application/x-tex">v=d/t</annotation></semantics></math></span>';
const KATEX_BLOCK =
  '<span class="katex"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>E</mi></mrow>' +
  '<annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span>';

function lessonWithMath(...bodies: string[]): LessonOutput {
  return {
    topic: "Math",
    level: "intro",
    language: "en",
    synopsis: "Has math.",
    learning_objectives: ["See math"],
    sections: bodies.map((b, i) => ({ heading: `S${i}`, body_markdown: b })),
    key_takeaways: ["Math helps"],
    further_reading: [],
  };
}
function bookWithLesson(lesson: LessonOutput): Book {
  return {
    id: "33333333-3333-3333-3333-333333333333",
    title: "Math Book",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    content: { u1: { topicId: "u1", title: "T", lesson, generatedAt: "2026-08-17T00:00:00.000Z" } },
  };
}

describe("collectMathHtml", () => {
  it("extracts every rendered KaTeX MathML span, in order", () => {
    const html = `<p>before</p>${KATEX_INLINE}<p>mid</p>${KATEX_BLOCK}`;
    const lesson = lessonWithMath(html);
    const found = collectMathHtml(bookWithLesson(lesson));
    expect(found).toHaveLength(2);
    expect(found[0]).toContain("v=d/t");
    expect(found[1]).toContain("E=mc^2");
  });
});

describe("rasterizeMath", () => {
  it("batches unique MathML fragments and returns a data-URI PNG per fragment", async () => {
    const map = await rasterizeMath([KATEX_INLINE, KATEX_INLINE, KATEX_BLOCK]);
    expect(map.size).toBe(2); // deduped
    expect(map.get(KATEX_INLINE)).toMatch(/^data:image\/png;base64,/);
  });

  it("returns an empty map without rasterizing when there is no math", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    (rasterizeManyToPngResilient as jest.Mock).mockClear();
    const map = await rasterizeMath([]);
    expect(map.size).toBe(0);
    expect(rasterizeManyToPngResilient).not.toHaveBeenCalled();
  });

  it("omits a fragment from the map (never rejects) when the resilient rasterizer reports it null — the real trigger for replaceMathWithImages' MathML fallback", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((_, i) => (i === 1 ? null : Buffer.from(`png-${i}`))),
    );
    const map = await rasterizeMath([KATEX_INLINE, KATEX_BLOCK]);
    expect(map.size).toBe(1);
    expect(map.has(KATEX_INLINE)).toBe(true);
    expect(map.has(KATEX_BLOCK)).toBe(false); // this one "failed to rasterize"
  });
});

describe("replaceMathWithImages", () => {
  it("replaces a matched fragment with an <img> carrying the LaTeX as alt, tagged inline vs block", () => {
    const pngByMathml = new Map([
      [KATEX_INLINE, "data:image/png;base64,AAA="],
      [KATEX_BLOCK, "data:image/png;base64,BBB="],
    ]);
    const out = replaceMathWithImages(`<p>${KATEX_INLINE}</p><p>${KATEX_BLOCK}</p>`, pngByMathml);
    expect(out).toContain('<img class="math math-inline" alt="v=d/t" src="data:image/png;base64,AAA="/>');
    expect(out).toContain('<img class="math math-block" alt="E=mc^2" src="data:image/png;base64,BBB="/>');
    expect(out).not.toContain("<math");
  });

  it("leaves a fragment unchanged (never breaks the compile) on a raster miss", () => {
    const out = replaceMathWithImages(`<p>${KATEX_INLINE}</p>`, new Map());
    expect(out).toContain("<math");
    expect(out).not.toContain("<img");
  });

  it("end-to-end: one fragment failing to rasterize stays MathML while the rest become <img>", async () => {
    const { rasterizeManyToPngResilient } = require("../src/rasterize");
    (rasterizeManyToPngResilient as jest.Mock).mockImplementationOnce(async (svgs: string[]) =>
      svgs.map((svg: string) => (svg === KATEX_BLOCK ? null : Buffer.from("ok"))),
    );
    const pngByMathml = await rasterizeMath([KATEX_INLINE, KATEX_BLOCK]);
    const out = replaceMathWithImages(`<p>${KATEX_INLINE}</p><p>${KATEX_BLOCK}</p>`, pngByMathml);
    expect(out).toMatch(/<img class="math math-inline" alt="v=d\/t"/); // rasterized
    expect(out).toContain(KATEX_BLOCK); // failed fragment — untouched MathML
  });
});
