import type { Book, TopicAudio, TopicImage } from "@/types/book";

/**
 * How many figures a book carries in total, counted from the schema refs alone.
 *
 * Needs no bytes on disk — `book.content[*].images[]` are refs (media slice 1),
 * so this answers "does this book have figures?" for a book that arrived over
 * the wire with no media. That is exactly the shared-draft case (#320): the
 * author is warned their figures won't travel, and the reviewer is told some
 * exist, both from `book_json` alone.
 */
export function countBookFigures(book: Book): number {
  return Object.values(book?.content ?? {}).reduce((n, gen) => n + (gen?.images?.length ?? 0), 0);
}

// Self-contained HTML escaper (this module is imported by both the web reader and
// the WebView builder; keep it dependency-free).
function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * The alt text for one figure — the SINGLE place alt is decided.
 *
 * Three surfaces render a figure (this module for the web reader, the mirrored
 * JS twin in `contentHtml.ts` for the WebView, and `compilePayload.ts` for the
 * compiled EPUB/PDF). They each used to inline their own expression and they
 * DISAGREED: the readers emitted `alt=""` while the compile payload emitted
 * `"Fig 1. "`. Everything now routes through here so they cannot drift again.
 *
 * **Never returns `""`.** An empty alt is HTML for "decorative — skip me", and a
 * figure an author attached to a lesson topic is meaningful by definition;
 * claiming otherwise silently hides it from screen readers. When the author has
 * given nothing, a positional label is weak but honest — it says something is
 * there and never lies about what.
 *
 * Precedence: explicit alt → caption → "Figure N". Blank/whitespace counts as
 * absent, so a stray space can't reintroduce a meaningless alt.
 */
export function figureAltText(img: TopicImage, index: number): string {
  return img.alt?.trim() || img.caption?.trim() || `Figure ${index + 1}`;
}

/**
 * A "Figures" section for a topic's attached images. Only images whose id has a
 * resolved data: URL are rendered. `src` is ALWAYS a caller-provided data: URL
 * (never remote) — the local-only invariant.
 */
export function renderFiguresHtml(images: TopicImage[], dataUrls: Map<string, string>): string {
  const figs = (images ?? [])
    .map((img, i) => {
      const src = dataUrls.get(img.id);
      if (!src) return "";
      const cap = img.caption ? `<figcaption>${esc(img.caption)}</figcaption>` : "";
      return `<figure class="attached-figure"><img src="${esc(src)}" alt="${esc(figureAltText(img, i))}">${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
  if (!figs) return "";
  return `<hr class="section-divider"><section class="figures"><h3>Figures</h3>${figs}</section>`;
}

/** The figcaption for one narration clip — falls back to a generic label. */
export function audioCaption(audio: TopicAudio): string {
  return audio.title?.trim() || "Narration";
}

/**
 * Audio clips for a topic, as raw `<audio>` markup. Only clips whose id has a
 * resolved data: URL are rendered — same "resolved-only" contract as
 * renderFiguresHtml. `src` is ALWAYS a caller-provided data: URL (never
 * remote) — the local-only invariant.
 *
 * Unlike renderFiguresHtml this returns bare `<figure>` markup with NO
 * wrapping `<section>`/heading: the caller (compilePayload.ts) embeds the
 * result as the body_markdown of its own "Narration" LessonSection, which
 * already carries the heading.
 */
export function renderAudioHtml(audio: TopicAudio[], dataUrls: Map<string, string>): string {
  return (audio ?? [])
    .map((a) => {
      const src = dataUrls.get(a.id);
      if (!src) return "";
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      // `controls="controls"` — NOT the bare boolean `controls`. This module's
      // markup is embedded as raw HTML inside a compiled EPUB3 chapter, which
      // gets parsed as XML; a bare boolean attribute is a FATAL well-formedness
      // error there (epubcheck RSC-016). Same convention as the checkbox
      // renderer in `compiler/src/markdown.ts` (`checked="checked"
      // disabled="disabled"`), for the same XHTML/XML reason.
      return `<figure class="topic-audio"><audio controls="controls" src="${esc(src)}"></audio>${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
}

/**
 * Audio clips for a topic as prose "Narration (transcript)" markup — the
 * EPUB 2 / max-compatibility fallback (ADR-041 Initiative A D4,
 * docs/superpowers/specs/2026-08-18-epub2-export-profile-design.md). EPUB 2
 * is XHTML 1.1 and can't carry `<audio>`, so the narration's WORDS survive as
 * a paragraph per clip instead of the clip itself. A clip with no transcript
 * is skipped (nothing to show). Unlike renderAudioHtml this needs no resolved
 * data: URL — transcript text has no bytes to resolve, so this function is
 * synchronous and takes no dataUrls map.
 */
export function renderAudioTranscriptHtml(audio: TopicAudio[]): string {
  return (audio ?? [])
    .map((a) => {
      const text = a.transcript?.trim();
      if (!text) return "";
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      return `<figure class="topic-audio-transcript"><p>${esc(text)}</p>${cap}</figure>`;
    })
    .filter(Boolean)
    .join("");
}

// Reader-side audio block (ADR-040 rung 3) — DISTINCT from renderAudioHtml
// (the compiler/EPUB path) and renderAudioTranscriptHtml (epub2). This renders
// the in-app reader's player:
//   - web target: the browser's native <audio controls> transport, fed the
//     resolved data: URI (plays direct-to-DOM). A clip with no resolved url is
//     omitted (the file was missing).
//   - native target: an id-keyed control block (play/pause button + seek range +
//     time), NO <audio> element and NO data: URI — ExoPlayer data:-URI playback
//     is unreliable across OEMs (see AudioNarrationPlayer.tsx). The WebView's
//     injected JS wires these to the expo-audio bridge in LessonRenderer.
// Both targets always render the transcript in a <details> (a11y + resilience).
function readerAudioTranscript(a: TopicAudio): string {
  const text = a.transcript?.trim();
  if (!text) return "";
  return `<details class="rd-audio-transcript"><summary>Transcript</summary><p>${esc(text)}</p></details>`;
}

export function renderReaderAudioHtml(
  audio: TopicAudio[],
  opts: { target: "web" | "native"; dataUrls?: Map<string, string> },
): string {
  const blocks = (audio ?? [])
    .map((a) => {
      const cap = `<figcaption>${esc(audioCaption(a))}</figcaption>`;
      const transcript = readerAudioTranscript(a);
      if (opts.target === "web") {
        const src = opts.dataUrls?.get(a.id);
        if (!src) return ""; // missing file → omit the player (web can't bridge)
        return `<figure class="topic-audio" data-audio-id="${esc(a.id)}"><audio class="rd-audio" controls="controls" preload="none" src="${esc(src)}"></audio>${cap}${transcript}</figure>`;
      }
      // native: id-only control block, driven by the WebView bridge.
      const id = esc(a.id);
      const control =
        `<div class="rd-audio-ctl">` +
        `<button type="button" class="rd-audio-toggle" data-audio-id="${id}" aria-label="Play">&#9658;</button>` +
        `<input type="range" class="rd-audio-seek" data-audio-id="${id}" min="0" max="0" value="0" step="1" aria-label="Seek">` +
        `<span class="rd-audio-time" data-audio-id="${id}">0:00&nbsp;/&nbsp;0:00</span>` +
        `</div>`;
      return `<figure class="topic-audio" data-audio-id="${id}">${control}${cap}${transcript}</figure>`;
    })
    .filter(Boolean)
    .join("");
  if (!blocks) return "";
  return `<hr class="section-divider"><section class="audio"><h3>Narration</h3>${blocks}</section>`;
}
