# Publish → Add to Library + Download EPUB/PDF — Design

**Status:** Approved (brainstorming, 2026-08-06)
**Context:** ADR-037 trust Project workspace, Publish tab. Reuses the existing book / compiler /
Library machinery (ADR-003 authoring, ADR-004 EPUB/PDF pipeline). Companion prior slice: Publish
export as text/Markdown (`d1aa4f3`).

## Problem

The Publish tab only offers **Copy** / **Copy as Markdown** of a validated asset. For a long-form
asset (a book chapter, an essay, a guide) users want a real deliverable: **add it to the Library as
a book** and **download it as EPUB or PDF**. All the downstream machinery (save-to-Library, the
server EPUB/PDF compiler, web + native download, the trust-manifest badge) already exists and is
wired — the only missing piece is a converter from a validated trust artifact
(`{sections:[{heading,body,source_ids}]}`) into a `Book`.

## Goal

On the Publish tab, for **long-form** validated assets (`book` · `essay` · `guide`):
- **Add to Library** — convert the validated version into a `Book` and `saveBook` it (opens in the
  reader, which already exports too).
- **Download EPUB** / **Download PDF** — compile via the existing export pipeline and download.

**Social** assets (`linkedin` · `x_thread` · `reel` · `podcast`) keep the existing **Copy** /
**Copy as Markdown** unchanged (an EPUB of a 200-word post makes no sense).

## Non-goals

- **Open-Library / public publish** (`publishBook`, `POST /library/{id}/publish`) — ADR-027 flags
  that path as formally gated (moderation/DMCA prereqs). This is **local Library + download only**.
- Backend changes — the `/api/v1/export/*` compile endpoints already exist, are key-free, and take a
  raw `book.json`.
- Editing the generated book, multi-topic books, or cover customization.
- Word format (the "Pro — coming soon" row stays as-is).

## Data + reuse (all exists — cited)

- Validated version content: `getVersion(versionId, token)` → `VersionDetailView.content.sections`
  (`DraftSection {heading, body, source_ids}`) — fetched on demand, exactly like the current
  `onCopyAsset` (`trust/[projectId].tsx`).
- `Book` type (`mobile/src/types/book.ts`): `{ id, title, toc: StructuredTOC, content?:
  Record<topicId, GeneratedTopic>, createdAt, updatedAt }`. `StructuredTOC = { subjects:
  SubjectNode[] }`; `SubjectNode = { subject_label, units: TopicNode[] }`; `TopicNode = { id, title,
  subtopics: [], prerequisites: [] }`. `GeneratedTopic = { topicId, title, lesson: LessonOutput,
  generatedAt }`. `LessonOutput` (`mobile/src/types/lesson.ts`) = `{ topic, level, language,
  synopsis, learning_objectives, sections: LessonSection[], key_takeaways, further_reading }`;
  `LessonSection = { heading, body_markdown }`.
- `saveBook(book: Book): Promise<void>` (`mobile/src/storage/bookStore.ts`) — add to Library.
- `trackedExport(book, fmt, { diagrams })` (`mobile/src/lib/trackedExport.ts`) → `ExportedArtifact
  { artifact: ArrayBuffer, trust? }`; it calls `buildCompilePayload` internally. `fmt: "epub" |
  "pdf"`. Server compile, works web + native, no API key.
- `downloadArtifact(bytes: ArrayBuffer, filename, mimeType)` (`mobile/src/storage/epubLibrary.ts`) —
  web `<a download>`, native `FileSystem` + share sheet.
- `randomUUID()` from `@/lib/uuid` (Hermes has no global crypto).
- `project.inputs` (already on the detail screen's `useTrustProject().project`) — for the Sources
  section citation mapping.

## Architecture

### Converter (the only genuinely new logic) — `mobile/src/lib/artifactToBook.ts`

```ts
import { randomUUID } from "@/lib/uuid";
import type { Book } from "@/types/book";
import type { DraftSection, ProjectInputView } from "@/api/trustClient";

export function artifactToBook(
  sections: DraftSection[],
  title: string,
  inputs: ProjectInputView[],
): Book {
  const now = new Date().toISOString();
  const topicId = randomUUID();
  const safeTitle = title.trim() || "Untitled";

  const lessonSections = sections.map((s) => ({ heading: s.heading, body_markdown: s.body }));

  // Sources section from the UNION of cited source_ids, mapped to S-labels by
  // inputs order (same mapping the viewer/compare use). Omitted if nothing cited.
  const labelFor = new Map(inputs.map((inp, i) => [inp.id, `S${i + 1}`] as const));
  const cited = [...new Set(sections.flatMap((s) => s.source_ids ?? []))];
  if (cited.length) {
    const byId = new Map(inputs.map((inp) => [inp.id, inp] as const));
    const lines = cited.map((id) => {
      const inp = byId.get(id);
      const label = labelFor.get(id) ?? "cited";
      const name = inp ? (inp.title || inp.source_ref || inp.content.slice(0, 80)) : "(source)";
      return `- [${label}] ${name}`;
    });
    lessonSections.push({ heading: "Sources", body_markdown: lines.join("\n") });
  }

  const lesson = {
    topic: safeTitle, level: "", language: "en", synopsis: "",
    learning_objectives: [], sections: lessonSections, key_takeaways: [], further_reading: [],
  };

  return {
    id: randomUUID(),
    title: safeTitle,
    toc: { subjects: [{ subject_label: safeTitle, units: [{ id: topicId, title: safeTitle, subtopics: [], prerequisites: [] }] }] },
    content: { [topicId]: { topicId, title: safeTitle, lesson, generatedAt: now } },
    createdAt: now,
    updatedAt: now,
  };
}
```

Notes: `title` must be non-empty (the compiler 422s otherwise) — hence `safeTitle`. `source_ids`
land in the appended Sources section (the "trust is the product" provenance stays visible), matching
the approved decision. At least one section always exists (the artifact has ≥1), so the book is
renderable (`lesson.sections.length > 0`).

### Publish panel changes — `mobile/app/trust/[projectId].tsx`

- Add `const LONG_FORM = new Set(["book", "essay", "guide"]);`.
- In `PublishPanel`, per publishable `{ artifact, version }`, branch on `artifact.format`:
  - `LONG_FORM.has(artifact.format)` → render **Add to Library**, **Download EPUB**, **Download
    PDF** (each a `Pressable`, per-action busy state, `accessibilityLabel` `Add {title} to Library` /
    `Download {title} as EPUB` / `Download {title} as PDF`).
  - else → the existing **Copy** / **Copy as Markdown** rows (unchanged).
- New handlers in `TrustProjectDetailInner` (mirroring `onCopyAsset`, which already fetches content
  via `getVersion` on demand):
  - `onAddToLibrary(versionId, title, artifactFormat)`: `getVersion` → `artifactToBook(content.sections,
    title, project.inputs)` → `saveBook(book)` → `Alert.alert("Added", "Added to your Library.")`.
  - `onDownloadAsset(versionId, title, fmt: "epub" | "pdf")`: `getVersion` → `artifactToBook(...)` →
    `trackedExport(book, fmt, { diagrams: true })` → `downloadArtifact(res.artifact, `${slug(title)}.${fmt}`,
    fmt === "epub" ? "application/epub+zip" : "application/pdf")`. Busy keyed `${versionId}:${fmt}`.
- Errors: `try/catch` → `Alert.alert` with `ApiError.userMessage()` / `Error.message` fallback;
  clear busy in `finally`. (Compile can be slow — the existing `trackedExport` has a 20-min poll
  ceiling and a generating→done/failed status; a spinner on the button is enough here.)
- Thread `project.inputs`, the busy state, and the three handlers into `PublishPanel` props.

### Theme / platform

- `useThemedStyles` (selected theme, no forced navy). Buttons reuse the existing Publish styles
  (`approveBtn`, `pubActions`) + a small set for the new row; `as const` on literals.
- Web-primary: `saveBook` (web IndexedDB/AsyncStorage) and `downloadArtifact` (browser download)
  both work on web; `trackedExport` is a backend call. Native also supported (share sheet).

## Data flow

```
Publish tab (long-form asset) → Download EPUB
  → getVersion(versionId)                       # on-demand, like Copy
  → artifactToBook(sections, title, inputs)     # + Sources section
  → trackedExport(book, "epub", {diagrams:true}) # buildCompilePayload → POST /export/jobs → poll → artifact
  → downloadArtifact(bytes, "<slug>.epub", "application/epub+zip")  # web <a> / native share

Publish tab (long-form asset) → Add to Library
  → getVersion → artifactToBook → saveBook(book)  → "Added to your Library."
  (book now opens in the reader, which itself exports EPUB/PDF)
```

## Testing

**Mobile (Jest + RNTL):**
- `artifactToBook`: maps `{heading,body}` → `{heading, body_markdown}`; appends a **Sources**
  section listing cited inputs by `S{n}` label + title when `source_ids` present; **no** Sources
  section when nothing cited; `title` empty → "Untitled"; ids present; `content[topicId].lesson.sections`
  non-empty.
- PublishPanel: a `book`/`essay`/`guide` asset renders **Add to Library** + **Download EPUB** +
  **Download PDF** (not Copy); a `linkedin` asset renders **Copy** / **Copy as Markdown** (not the
  book actions).
- `onAddToLibrary` calls `getVersion` then `saveBook` with a converted book (assert `saveBook`
  called with a book whose `content` has one topic + the mapped sections).
- `onDownloadAsset` calls `trackedExport(book, "epub"/"pdf", {diagrams:true})` then
  `downloadArtifact` with the right filename + mime (mock both).
- Existing Publish (Copy) + TrustProjectDetail suites stay green.

## Files

**Mobile**
- `src/lib/artifactToBook.ts` (new) + `mobile/__tests__/lib/artifactToBook.test.ts`.
- `app/trust/[projectId].tsx` — PublishPanel format split + the 3 handlers.
- Tests under `mobile/__tests__/screens/` (Publish book-actions).

**Backend:** none.

## Rollout

Mobile/web only — **no backend change, no migration**. Ship = web redeploy (+ APK if native
wanted). The export/compile endpoints are already live on prod (`/api/v1/export/*`).
