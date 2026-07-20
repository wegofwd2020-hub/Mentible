// Plaintext extraction for chapter source text fed to source-grounded quiz
// generation (Open Shelves F2, Task 2 — see docs/superpowers/plans/
// 2026-07-19-open-shelves-f2-chapter-quiz.md).
//
// This deliberately does NOT call `toPlainText()` from ./normalize directly:
// that function's `MAX_FIELD_LEN` (4096) is sized for short OPDS feed metadata
// fields (title/author/summary), not a multi-thousand-word chapter body. Instead
// this reuses `decodeEntities()` — the same entity-decode table normalize.ts
// already uses on untrusted feed strings — and the identical tag-strip +
// whitespace-collapse steps `toPlainText()` performs internally, just with its
// own, much larger cap (`MAX_QUIZ_SOURCE`). No new sanitization logic: the
// regex here is the same one `toPlainText()` uses, only the length ceiling
// differs. This is plaintext extraction, not an HTML sanitizer — the output is
// only ever sent to the backend as `source_text`, never rendered as HTML.
import { decodeEntities } from "@/openshelves/normalize";
import type { ImportedChapter } from "@/types/book";

// Keeps comfortably under the backend's source_text cap (16000 chars, Task 1)
// while giving a real chapter enough room to ground a 5-question quiz (plan OQ1).
export const MAX_QUIZ_SOURCE = 12000;

export interface ChapterPlainText {
  text: string;
  // True when the chapter's plaintext exceeded MAX_QUIZ_SOURCE and was cut —
  // surfaced to the UI as a truncation hint (Task 3).
  truncated: boolean;
}

// Strip `chapter.html` down to inert plaintext for the quiz prompt's
// `source_text`. Read-only: never mutates or re-derives `chapter.html` itself
// (the F1 read-only invariant lives in the caller, not here — this function
// doesn't even have a way to write back).
export function chapterPlainText(chapter: ImportedChapter): ChapterPlainText {
  const decoded = decodeEntities(chapter.html ?? "");
  const collapsed = decoded
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = collapsed.length > MAX_QUIZ_SOURCE;
  return { text: truncated ? collapsed.slice(0, MAX_QUIZ_SOURCE) : collapsed, truncated };
}
