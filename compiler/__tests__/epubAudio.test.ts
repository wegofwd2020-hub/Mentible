import JSZip from "jszip";
import { compileEpub } from "../src/epub";
import type { Book } from "../src/types";

// A tiny fake MP3 payload (not a real decodable clip — this test only proves
// the extract/pack/manifest mechanics, not audio validity; the real-render
// check at the end of this task covers a genuinely playable clip).
const MP3_B64 = Buffer.from("ID3-fake-mp3-bytes").toString("base64");

function audioHtml(b64: string): string {
  // Valued boolean attribute (`controls="controls"`, not bare `controls`) —
  // this is XHTML/XML content, and a bare boolean attribute is a FATAL
  // well-formedness error there (epubcheck RSC-016). Matches what
  // mobile/src/lib/figuresHtml.ts actually emits post-fix.
  return `<figure class="topic-audio"><audio controls="controls" src="data:audio/mpeg;base64,${b64}"></audio><figcaption>Intro</figcaption></figure>`;
}

function bookWithAudio(clips: string[]): Book {
  return {
    id: "b1",
    title: "Audio",
    updatedAt: "2026-01-01T00:00:00Z",
    toc: {
      subjects: [{
        subject_label: "S",
        units: clips.map((_, i) => ({ id: `t${i + 1}`, title: `T${i + 1}` })),
      }],
    },
    content: Object.fromEntries(
      clips.map((b64, i) => [
        `t${i + 1}`,
        {
          topicId: `t${i + 1}`,
          title: `T${i + 1}`,
          lesson: {
            topic: `T${i + 1}`, level: "intro", language: "en", synopsis: "s",
            learning_objectives: ["a"],
            sections: [{ heading: "Narration", body_markdown: audioHtml(b64) }],
            key_takeaways: ["k"], further_reading: [],
          },
        },
      ]),
    ),
  } as unknown as Book;
}

describe("compileEpub — embedded audio", () => {
  it("extracts a data-URI audio clip into a packaged resource + manifest item", async () => {
    const bytes = await compileEpub(bookWithAudio([MP3_B64]));
    const zip = await JSZip.loadAsync(bytes);

    const audPath = Object.keys(zip.files).find((f) => /^OEBPS\/audio\/aud-001\.mp3$/.test(f));
    expect(audPath).toBeTruthy();

    const ch = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(ch).toContain('src="../audio/aud-001.mp3"');
    expect(ch).not.toContain("data:audio");
    expect(ch).toContain('<audio controls="controls"');

    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('href="audio/aud-001.mp3"');
    expect(opf).toContain('media-type="audio/mpeg"');
  });

  it("dedupes identical clips across chapters", async () => {
    const bytes = await compileEpub(bookWithAudio([MP3_B64, MP3_B64]));
    const zip = await JSZip.loadAsync(bytes);
    const audFiles = Object.keys(zip.files).filter((f) => /^OEBPS\/audio\/aud-\d+\.mp3$/.test(f));
    expect(audFiles).toEqual(["OEBPS/audio/aud-001.mp3"]); // second chapter reused aud-001
    const ch2 = await zip.file("OEBPS/chapters/ch-002.xhtml")!.async("string");
    expect(ch2).toContain('src="../audio/aud-001.mp3"');
  });
});

// Locks packMedia's per-caller fallback extension (fix-round 1): packImages
// must keep its pre-refactor "img" fallback for an unmapped image mime type
// byte-for-byte, while packAudio's fallback is the separate, intentional
// "bin" — not a shared hardcoded default that silently changed packImages's
// output.
describe("compileEpub — packMedia fallback extension (per-caller, not shared)", () => {
  function bookWithBody(bodyMarkdown: string): Book {
    return {
      id: "b3",
      title: "Fallback",
      updatedAt: "2026-01-01T00:00:00Z",
      toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "T1" }] }] },
      content: {
        t1: {
          topicId: "t1",
          title: "T1",
          lesson: {
            topic: "T1", level: "intro", language: "en", synopsis: "s",
            learning_objectives: ["a"],
            sections: [{ heading: "H", body_markdown: bodyMarkdown }],
            key_takeaways: ["k"], further_reading: [],
          },
        },
      },
    } as unknown as Book;
  }

  it("packImages: an unmapped image mime (bmp) still falls back to .img (pre-refactor behavior)", async () => {
    const b64 = Buffer.from("BM-fake-bmp-bytes").toString("base64");
    const body = `<img src="data:image/bmp;base64,${b64}"/>`;
    const bytes = await compileEpub(bookWithBody(body));
    const zip = await JSZip.loadAsync(bytes);

    const imgPath = Object.keys(zip.files).find((f) => /^OEBPS\/images\/img-001\.img$/.test(f));
    expect(imgPath).toBeTruthy();

    const ch = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(ch).toContain('src="../images/img-001.img"');
    expect(ch).not.toContain("data:image");
  });

  it("packAudio: an unmapped audio mime falls back to .bin (intentional, separate from packImages)", async () => {
    const b64 = Buffer.from("weird-audio-bytes").toString("base64");
    const body = `<audio controls="controls" src="data:audio/x-unknown;base64,${b64}"></audio>`;
    const bytes = await compileEpub(bookWithBody(body));
    const zip = await JSZip.loadAsync(bytes);

    const audPath = Object.keys(zip.files).find((f) => /^OEBPS\/audio\/aud-001\.bin$/.test(f));
    expect(audPath).toBeTruthy();

    const ch = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(ch).toContain('src="../audio/aud-001.bin"');
    expect(ch).not.toContain("data:audio");
  });
});

describe("compileEpub — no-audio regression", () => {
  function bookWithNoAudio(): Book {
    return {
      id: "b2",
      title: "Plain",
      updatedAt: "2026-01-01T00:00:00Z",
      toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "T1" }] }] },
      content: {
        t1: {
          topicId: "t1",
          title: "T1",
          lesson: {
            topic: "T1", level: "intro", language: "en", synopsis: "s",
            learning_objectives: ["a"],
            sections: [{ heading: "H", body_markdown: "Just text, no media." }],
            key_takeaways: ["k"], further_reading: [],
          },
        },
      },
    } as unknown as Book;
  }

  it("emits no OEBPS/audio/ entries and no audio/mpeg manifest item", async () => {
    const bytes = await compileEpub(bookWithNoAudio());
    const zip = await JSZip.loadAsync(bytes);
    const audFiles = Object.keys(zip.files).filter((f) => f.startsWith("OEBPS/audio/"));
    expect(audFiles).toHaveLength(0);
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).not.toContain("audio/mpeg");
  });
});
