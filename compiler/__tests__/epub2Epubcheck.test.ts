// The D6 gate (docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md):
// the epub2-profile output must pass epubcheck AS EPUB 2 (epubcheck
// auto-detects the OPF version from content.opf) with zero fatals/errors.
// This fixture carries math, a Mermaid diagram, narration audio, AND a GFM
// task-list checklist — every one of the profile's lossy-downgrade paths (D2
// raster math/diagrams, D4 strip audio, fix round 2's checkbox→glyph swap) in
// one book, so a regression in any of them (a stray <math>, an un-rastered
// <svg>, a surviving <audio> element, a surviving <input type="checkbox"> —
// none of which are valid in strict XHTML 1.1) fails this gate. The
// checklist section is fix round 2's regression guard: the original fixture
// had no checklist, so CI missed that markdown.ts's checkbox() renderer
// emits a raw <input> that XHTML 1.1 (no Forms module) rejects. Needs Java
// (to run epubcheck.jar) — auto-skips locally without it, mirroring
// kdpEpubcheck.test.ts's `gated` pattern.
//
// rasterize.ts is mocked (real Puppeteer/Chromium is not required to prove
// EPUB2 packaging validity) but returns a REAL, decodable 1x1 PNG — unlike
// kdpEpubcheck.test.ts's fixture (deliberately "no math, no diagrams"), this
// fixture's math+diagram sections DO reach the mocked rasterizer, so
// (mirroring kdpEpubcheck.test.ts's real-JPEG comment and
// audioEpubcheck.test.ts's real-MP3 comment) the bytes must be genuine,
// decodable image bytes, not arbitrary ones.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileEpub } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

// A real, tiny (1x1, transparent) decodable PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

// A real, verified-valid tiny (2x2) JPEG — same bytes kdpEpubcheck.test.ts
// uses. epub2's cover rasters to JPEG too as of fix round 1 (epub.ts's
// `profile !== "default"` cover branch), so this mock now needs
// rasterizeToJpeg too; epubcheck decodes image bytes, so arbitrary bytes
// won't do.
const JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPngResilient: jest.fn(async (items: string[]) =>
    items.map(() => Buffer.from(PNG_B64, "base64")),
  ),
  rasterizeToJpeg: jest.fn(async () => Buffer.from(JPEG_B64, "base64")),
}));

function javaAvailable(): boolean {
  try {
    execFileSync("java", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const EPUBCHECK_JAR = require("epubcheck-assets") as string;
const gated = javaAvailable() ? describe : describe.skip;

// The exact shape mobile/src/lib/figuresHtml.ts renderAudioHtml() produces —
// see audioEpubcheck.test.ts. A genuine, tiny (~2KB), decodable MP3. This
// clip is expected to be STRIPPED by the epub2 profile before packaging, so
// its content never actually reaches epubcheck's media validation — using
// real bytes anyway is defense-in-depth: if the strip regresses, epubcheck
// hits a real (still invalid-for-XHTML1.1) <audio> element, not a
// false-negative from an unreachable fake payload.
const MP3_B64 =
  "//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAIKAAcHBwcHBwcHBwcHDg4ODg4ODg4ODg4VVVVVVVVVVVVVVVxcXFxcXFxcXFxcY6Ojo6Ojo6Ojo6OqqqqqqqqqqqqqqrHx8fHx8fHx8fHx+Pj4+Pj4+Pj4+Pj//////////////8AAAA5TEFNRTMuMTAwAaUAAAAALf4AABRAJAPMQgAAQAAACCiPUdGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEXYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

function audioHtml(): string {
  return `<figure class="topic-audio"><audio controls="controls" src="data:audio/mpeg;base64,${MP3_B64}"></audio><figcaption>Intro</figcaption></figure>`;
}

const LESSON: LessonOutput = {
  topic: "EPUB2 Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the epub2 epubcheck gate: math, a diagram, and narration audio.",
  learning_objectives: ["Understand the gate"],
  sections: [
    { heading: "Motion", body_markdown: "Velocity is $v = d/t$." },
    { heading: "Flow", body_markdown: "```mermaid\ngraph TD; A-->B;\n```" },
    { heading: "Narration", body_markdown: audioHtml() },
    // GFM task-list (fix round 2 regression guard) — markdown.ts's checkbox()
    // renders each of these as a raw <input type="checkbox">.
    { heading: "Checklist", body_markdown: "- [ ] Unchecked item\n- [x] Checked item\n" },
  ],
  key_takeaways: ["It validates"],
  further_reading: [],
};

function fixtureBook(): Book {
  return {
    id: "66666666-6666-6666-6666-666666666666",
    title: "EPUB2 Epubcheck Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-18T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
    metadata: { author: "Fixture Author" },
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-18T00:00:00.000Z" } },
  };
}

const fakeMermaid = {
  renderAll: async (sources: readonly string[]) =>
    new Map(sources.map((s) => [s, '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'])),
};

gated("epub2-profile EPUB — epubcheck gate (D6)", () => {
  it("passes epubcheck AS EPUB 2 with zero fatals/errors (math rastered, diagram rastered, audio stripped, checklist glyph-swapped)", async () => {
    const bytes = await compileEpub(fixtureBook(), { mermaid: fakeMermaid, profile: "epub2" });
    const tmp = path.join(os.tmpdir(), `epub2-epubcheck-${Date.now()}.epub`);
    fs.writeFileSync(tmp, bytes);
    let output = "";
    try {
      output = execFileSync("java", ["-jar", EPUBCHECK_JAR, tmp], { encoding: "utf8" });
    } catch (err) {
      // epubcheck exits non-zero on errors; stdout/stderr still carries the report.
      const e = err as { stdout?: string; message: string };
      output = e.stdout ?? e.message;
    } finally {
      fs.unlinkSync(tmp);
    }
    expect(output).toMatch(/0 fatals \/ 0 errors \//);
  }, 60_000);
});
