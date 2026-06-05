import JSZip from "jszip";
import { compileEpub } from "../src/epub";
import type { Book } from "../src/types";

// 1x1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function bookWithImage(): Book {
  return {
    id: "b1",
    title: "Imgs",
    updatedAt: "2026-01-01T00:00:00Z",
    toc: { subjects: [{ subject_label: "S", units: [{ id: "t1", title: "T1" }] }] },
    content: {
      t1: {
        topicId: "t1",
        title: "T1",
        lesson: {
          topic: "T1",
          level: "intro",
          language: "en",
          synopsis: "s",
          learning_objectives: ["a"],
          sections: [
            { heading: "Pic", body_markdown: `Here:\n\n![diagram](data:image/png;base64,${PNG_B64})` },
          ],
          key_takeaways: ["k"],
          further_reading: [],
        },
      },
    },
  } as unknown as Book;
}

describe("compileEpub — embedded images", () => {
  it("extracts a data-URI image into a packaged resource + manifest item", async () => {
    const bytes = await compileEpub(bookWithImage());
    const zip = await JSZip.loadAsync(bytes);

    // image file packaged
    const imgPath = Object.keys(zip.files).find((f) => /^OEBPS\/images\/img-001\.png$/.test(f));
    expect(imgPath).toBeTruthy();

    // chapter references the packaged path, not a data URI
    const ch = await zip.file("OEBPS/chapters/ch-001.xhtml")!.async("string");
    expect(ch).toContain('src="../images/img-001.png"');
    expect(ch).not.toContain("data:image");

    // manifest declares it with the right media-type
    const opf = await zip.file("OEBPS/content.opf")!.async("string");
    expect(opf).toContain('href="images/img-001.png"');
    expect(opf).toContain('media-type="image/png"');
  });
});
