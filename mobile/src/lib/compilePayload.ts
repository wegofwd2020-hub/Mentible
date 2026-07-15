import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls } from "@/storage/mediaStore";

function mdEsc(s: string): string {
  return s.replace(/([[\]()\\])/g, "\\$1");
}

// The remote compiler is a stateless HTTP service — the app POSTs the whole
// Book JSON and there is no separate media channel. So an attached image can
// only reach the compiler as a base64 data: URI already inline in a topic's
// markdown; the compiler's existing packImages() extracts those into EPUB
// resources (the PDF path renders the same inline <img>).
//
// Deep-copy the book and, for each topic with attached images, append a
// synthetic "Figures" lesson section whose markdown embeds each resolved
// image in author order. The stored book is never mutated — callers must use
// the returned copy for the compile POST, not the original.
export async function buildCompilePayload(book: Book): Promise<Book> {
  const copy: Book = JSON.parse(JSON.stringify(book));
  for (const gen of Object.values(copy.content ?? {})) {
    const topic = gen as GeneratedTopic;
    if (!topic.images?.length) continue;

    const urls = await resolveFigureDataUrls(topic);
    const md = topic.images
      .map((img, i) => {
        const src = urls.get(img.id);
        if (!src) return null; // missing/unreadable file → omit that figure
        const cap = img.caption ? mdEsc(img.caption) : "";
        return `![Fig ${i + 1}. ${cap}](${src})`;
      })
      .filter((line): line is string => line !== null)
      .join("\n\n");
    if (!md) continue;

    const section: LessonSection = { heading: "Figures", body_markdown: md };
    topic.lesson.sections = [...(topic.lesson.sections ?? []), section];
  }
  return copy;
}
