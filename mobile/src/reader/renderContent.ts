// The WEB reader's boundary: the shared renderer plus exactly ONE DOMPurify pass.
//
// Web-only, because DOMPurify needs a DOM (see `@/reader/sanitize` — "Never
// import this from a non-`.web` module"). The rendering itself lives in
// `@/reader/topicHtml`, which is Hermes-safe and shared with the native reader;
// this file exists so importing the renderer never drags DOMPurify onto a
// platform that has no DOM.

import type { GeneratedTopic } from "@/types/book";
import { renderTopicToHtml } from "@/reader/topicHtml";
import { sanitizeFragment } from "@/reader/sanitize";

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
