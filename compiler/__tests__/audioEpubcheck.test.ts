// The bare boolean `controls` bug (mobile/src/lib/figuresHtml.ts renderAudioHtml)
// is a FATAL XML well-formedness error once a chapter with an `<audio>` clip
// is parsed as XML by epubcheck (RSC-016) — but the existing kdpEpubcheck.test.ts
// fixture is "plain prose, no audio", so it never exercises that code path.
// This test compiles a fixture book that DOES carry a real `data:audio/mpeg`
// clip and asserts the resulting EPUB passes epubcheck with 0 fatals/0 errors,
// so a regression to the bare-attribute form fails CI immediately instead of
// only failing a real reader on a real book.
//
// Needs Java (to run epubcheck.jar) — auto-skips locally without it, mirroring
// kdpEpubcheck.test.ts's `gated` pattern. Does not need Puppeteer/Chromium:
// the default profile emits inline SVG/MathML (no rasterization), and this
// fixture has no math or diagrams at all — audio is the only thing under test.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { compileEpub } from "../src/epub";
import type { Book, LessonOutput } from "../src/types";

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

// A genuine, tiny (~2KB), decodable MP3 — a fraction of a second of silence,
// encoded with LAME. epubcheck validates the manifest AND decodes referenced
// media, so (mirroring kdpEpubcheck.test.ts's real-JPEG comment) this must be
// real audio bytes, not arbitrary/fake ones.
const MP3_B64 =
  "//tQxAAAAAAAAAAAAAAAAAAAAAAASW5mbwAAAA8AAAAJAAAIKAAcHBwcHBwcHBwcHDg4ODg4ODg4ODg4VVVVVVVVVVVVVVVxcXFxcXFxcXFxcY6Ojo6Ojo6Ojo6OqqqqqqqqqqqqqqrHx8fHx8fHx8fHx+Pj4+Pj4+Pj4+Pj//////////////8AAAA5TEFNRTMuMTAwAaUAAAAALf4AABRAJAPMQgAAQAAACCiPUdGUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/7UMQAA8AAAaQAAAAgAAA0gAAABExBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEXYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVUxBTUUzLjEwMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVTEFNRTMuMTAwVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV//tSxKGDwAABpAAAACAAADSAAAAEVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVMQU1FMy4xMDBVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/+1LEoYPAAAGkAAAAIAAANIAAAARVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/7UsShg8AAAaQAAAAgAAA0gAAABFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV";

// The exact shape mobile/src/lib/figuresHtml.ts renderAudioHtml() produces
// (post-fix): a valued boolean `controls="controls"`, embedded as the
// body_markdown of a "Narration" lesson section by compilePayload.ts.
function audioHtml(): string {
  return `<figure class="topic-audio"><audio controls="controls" src="data:audio/mpeg;base64,${MP3_B64}"></audio><figcaption>Intro</figcaption></figure>`;
}

const LESSON: LessonOutput = {
  topic: "Audio Fixture",
  level: "intro",
  language: "en",
  synopsis: "A tiny fixture book for the audio epubcheck gate.",
  learning_objectives: ["Understand the gate"],
  sections: [
    { heading: "Section", body_markdown: "Plain prose, no math or diagrams." },
    { heading: "Narration", body_markdown: audioHtml() },
  ],
  key_takeaways: ["It validates"],
  further_reading: [],
};

function fixtureBook(): Book {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    title: "Audio Epubcheck Fixture",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "u1", title: "T1", subtopics: [], prerequisites: [] }] }] },
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    metadata: { author: "Fixture Author", status: "release" },
    content: { u1: { topicId: "u1", title: "T1", lesson: LESSON, generatedAt: "2026-08-19T00:00:00.000Z" } },
  };
}

gated("EPUB with narration audio — epubcheck gate", () => {
  it("passes epubcheck with zero fatals/errors (locks controls=\"controls\", not bare controls)", async () => {
    const bytes = await compileEpub(fixtureBook());
    const tmp = path.join(os.tmpdir(), `audio-epubcheck-${Date.now()}.epub`);
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
