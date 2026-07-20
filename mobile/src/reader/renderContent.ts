// The WEB reader's boundary: the shared renderer plus exactly ONE DOMPurify pass.
//
// Web-only, because DOMPurify needs a DOM (see `@/reader/sanitize` — "Never
// import this from a non-`.web` module"). The rendering itself lives in
// `@/reader/topicHtml`, which is Hermes-safe and shared with the native reader;
// this file exists so importing the renderer never drags DOMPurify onto a
// platform that has no DOM.

import type { GeneratedTopic, ImportedChapter, QuizSet } from "@/types/book";
import { renderChapterQuizToHtml, renderChapterToHtml, renderTopicToHtml } from "@/reader/topicHtml";
import { sanitizeFragment, sanitizeImportedChapterHtml } from "@/reader/sanitize";

/**
 * Untrusted topic → sanitized HTML fragment, safe to inject into the app's own
 * document. Exactly one sanitize pass, at the boundary — content reaches the app
 * DOM only through here, where localStorage holds the session and the BYOK key.
 */
export function renderTopicToSafeHtml(
  topic: GeneratedTopic,
  dataUrls?: Map<string, string>,
): string {
  return sanitizeFragment(renderTopicToHtml(topic, dataUrls));
}

/**
 * Untrusted, third-party chapter (Open Shelves import) → sanitized HTML
 * fragment. Distinct from `renderTopicToSafeHtml`'s plain `sanitizeFragment`
 * pass: a chapter also needs its image references resolved from its own
 * `images` map (or dropped) and every other URI-bearing attribute reduced to
 * `data:`-only — see `sanitizeImportedChapterHtml` (spec D-I4/D-I6).
 */
export function renderChapterToSafeHtml(chapter: ImportedChapter): string {
  return sanitizeImportedChapterHtml(renderChapterToHtml(chapter), chapter.images);
}

/**
 * A chapter quiz (Open Shelves F2) → sanitized HTML fragment. Uses the exact
 * same `sanitizeFragment` pass as `renderTopicToSafeHtml` — a `QuizSet` here
 * is OUR generated content (schema-validated, escaped by `renderQuizzes`),
 * not third-party prose, so it gets the topic boundary, not the chapter one
 * (`sanitizeImportedChapterHtml`'s stricter image-map handling doesn't apply
 * — a quiz carries no images).
 */
export function renderChapterQuizToSafeHtml(quiz: QuizSet): string {
  return sanitizeFragment(renderChapterQuizToHtml(quiz));
}
