import type { Book, GeneratedTopic } from "@/types/book";
import type { LessonSection } from "@/types/lesson";
import { resolveFigureDataUrls, resolveAudioDataUrls } from "@/storage/mediaStore";
import { figureAltText, renderAudioHtml } from "@/lib/figuresHtml";

function mdEsc(s: string): string {
  return s.replace(/([[\]()\\])/g, "\\$1");
}

// Every export target buildCompilePayload feeds: EPUB and its EPUB-based
// derivatives (kdp profile, the publish pack) can carry narration audio (the
// compiler's packAudio embeds it as a real EPUB resource); PDF and DOCX
// cannot — audio has nowhere to render there, so injecting it would only ship
// a dead, non-functional base64 blob (spec non-goal: "No PDF/DOCX audio
// (EPUB only)"). "pack" is included here (not just "epub") because the
// Publish Pack's KDP-EPUB is itself EPUB-based.
export type CompileFormat = "epub" | "pdf" | "docx" | "pack";

function isEpubFamily(format: CompileFormat): boolean {
  return format === "epub" || format === "pack";
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
//
// `format` gates the Narration/audio section — omitted defaults to "pdf" (no
// audio), the safe choice for a call site that doesn't know its target yet;
// callers that DO compile to an EPUB-family target must say so explicitly to
// get narration audio at all.
export async function buildCompilePayload(book: Book, format: CompileFormat = "pdf"): Promise<Book> {
  const copy: Book = JSON.parse(JSON.stringify(book));
  const withAudio = isEpubFamily(format);
  for (const gen of Object.values(copy.content ?? {})) {
    const topic = gen as GeneratedTopic;

    if (withAudio && topic.audio?.length) {
      const audioUrls = await resolveAudioDataUrls(topic);
      if (audioUrls.size) {
        const html = renderAudioHtml(topic.audio, audioUrls);
        if (html) {
          const section: LessonSection = { heading: "Narration", body_markdown: html };
          topic.lesson.sections = [...(topic.lesson.sections ?? []), section];
        }
      }
    }

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
