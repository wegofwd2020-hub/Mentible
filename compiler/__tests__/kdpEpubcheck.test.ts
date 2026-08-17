// The V gate (docs/specs/kdp-clean-export-profile.md): the kdp-profile output
// must pass epubcheck with zero fatals/errors. Needs Java (to run
// epubcheck.jar) — auto-skips locally without it, mirroring epub.test.ts's
// `realDescribe` pattern for the real-book gate. Does NOT need Puppeteer/
// Chromium — see the task's design note in the plan for why.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileEpub } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

jest.mock("../src/rasterize", () => ({
  rasterizeManyToPng: jest.fn(async (svgs: string[]) => svgs.map(() => Buffer.from("unused"))),
  rasterizeToPng: jest.fn(async () => Buffer.from("unused")),
  // A real, verified-valid tiny (2x2) JPEG — epubcheck decodes image bytes, so
  // this must be a genuine JPEG, not arbitrary bytes.
  rasterizeToJpeg: jest.fn(async () =>
    Buffer.from(
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAACAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDHooorhPqD/9k=",
      "base64",
    ),
  ),
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

const LESSON: LessonOutput = {
  topic: "KDP Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the epubcheck gate — no math, no diagrams.",
  learning_objectives: ["Understand the gate"],
  sections: [{ heading: "Section", body_markdown: "Plain prose, no math or diagrams." }],
  key_takeaways: ["It validates"],
  further_reading: [],
};

function fixtureBook(): Book {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    title: "KDP Epubcheck Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-17T00:00:00.000Z",
    updatedAt: "2026-08-17T00:00:00.000Z",
    metadata: { author: "Fixture Author", status: "release" },
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-17T00:00:00.000Z" } },
  };
}

gated("kdp-profile EPUB — epubcheck gate (V)", () => {
  it("passes epubcheck with zero fatals/errors", async () => {
    const bytes = await compileEpub(fixtureBook(), { profile: "kdp" });
    const tmp = path.join(os.tmpdir(), `kdp-epubcheck-${Date.now()}.epub`);
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
