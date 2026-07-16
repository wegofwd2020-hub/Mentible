import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls } from "@/storage/mediaStore";
import { figureAltText } from "@/lib/figuresHtml";

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
        // The markdown alt becomes the EPUB/PDF's <img alt>. It previously read
        // `Fig N. ${caption}`, which for an uncaptioned figure left a screen
        // reader with a bare "Fig 1." — present but meaningless, and different
        // again from the readers' alt="". All three surfaces now share the one
        // resolver. The VISIBLE caption is unaffected: it is rendered by the
        // compiler's own figure styling, not by this alt.
        return `![${mdEsc(figureAltText(img, i))}](${src})`;
      })
      .filter((line): line is string => line !== null)
      .join("\n\n");
    if (!md) continue;

    const section: LessonSection = { heading: "Figures", body_markdown: md };
    topic.lesson.sections = [...(topic.lesson.sections ?? []), section];
  }
  return copy;
}
