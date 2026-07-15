# Topic image attachments — design spec (media feature, slice 1)

**Date:** 2026-07-15
**Status:** Design approved (brainstorming); pending implementation plan
**Feature:** An author attaches image files to a specific topic. Images are stored
device-local, rendered in a "Figures" area of the reader, and embedded in the
compiled EPUB3/PDF artifact. Free tier only. No AI processing, no hosted sync,
no audio — those are later slices.

**Relates to:** ADR-003 (book authoring, local-first), ADR-014 (device-local /
zero-knowledge default = the free tier), ADR-033 (per-user private hosted library
= the *paid* tier that a later media-sync slice would extend), ADR-029 D5 (audio
transcription parked — informs why audio is a separate slice), ADR-034 (persona
honesty/compliance gates — do NOT fire for this slice because no media leaves the
device), ADR-028 (Open Shelves storage-accounting pattern reused for caps),
`docs/ARTIFACT_PIPELINE.md` (the content → EPUB3/PDF compile flow this extends).

---

## §1 — Scope, non-goals & tier boundary

**This slice (images-attach) is entirely FREE / device-local.** An author attaches
image files (photo library or camera) to a specific topic → bytes stored on-device
(`expo-file-system`) → rendered in a **Figures** panel in the reader **and** embedded
in the compiled **EPUB3/PDF** artifact → exported in a local `.book.json` + `/media`
bundle. No server call, no model call, no network egress.

**Tier boundary (explicit — so no reader infers a paywall):**

| Capability | Tier | Rationale |
|---|---|---|
| Attach / caption / reorder / delete images on a topic | **Free** | Bytes device-local (ADR-014 zero-knowledge default) |
| Render figures in reader | **Free** | On-device |
| Compile images into EPUB3/PDF | **Free** | On-device compile |
| Export `.book.json` + `/media` bundle | **Free** | Local file op |
| *Hosted* sync of media across devices | **Paid — later slice** (ADR-033) | Server-held → hosted tier, billing-gated |
| *AI processing* of images (vision / OCR → grounding) | **Later slice, tier TBD** | Cost + ADR-034 gates fire here |

**Non-goals (this slice):** no hosted media sync; no AI/vision/OCR processing; no
audio (attach or process — separate future slice; ADR-029 D5 already parks audio
transcription). The slice deliberately stops at "attach + display + compile + export,"
all free, so **no media leaves the device for any purpose** — which is why none of the
ADR-034 honesty/compliance gates apply to it.

---

## §2 — Data model

Add an optional `images` array to `GeneratedTopic` (`mobile/src/types/book.ts:136`),
and mirror the shape in `compiler/src/types.ts` so the compiler reads the same field.

```ts
// mobile/src/types/book.ts
export interface TopicImage {
  id: string;          // stable id (randomUUID via @/lib/uuid — Hermes has no global crypto)
  file: string;        // device-relative path, e.g. "media/<bookId>/<id>.jpg"
  mime: string;        // "image/jpeg" | "image/png" | "image/webp" (allowlist — see §3)
  caption?: string;    // author-authored caption / alt text (plain text)
  width?: number;      // intrinsic px (for layout + a11y); best-effort
  height?: number;     // intrinsic px
  addedAt: string;     // ISO timestamp
}

export interface GeneratedTopic {
  // ...existing fields...
  images?: TopicImage[];   // NEW — ordered; author-controlled order = render order
}
```

**Refs only — bytes never in stored `book.json`.** The JSON holds a lightweight ref;
bytes live in device file storage (§3). This keeps `book.json` small, fast to load/save,
and cheap for the (later) hosted-sync slice to reason about. Bytes are materialized into
base64 `data:` URIs only in two **transient** places that never persist: the reader's
figure resolver (§5) and the compile payload (§6).

`images` hangs off `GeneratedTopic` (not `TopicNode`) because that is the per-topic
content container the reader and compiler already consume, and it is what gets pruned
when a topic is removed (`content` is `Record<topicId, GeneratedTopic>`, pruned on save
— `book.ts:229-231`). A topic with attached images but no generated lesson is allowed:
`GeneratedTopic.lesson` stays required by the type, so slice 1 either (a) permits an
images-only topic by relaxing nothing and requiring a lesson first, or (b) — chosen —
attaches images only to topics that already have a `GeneratedTopic`. The "Add image"
affordance is therefore shown on topics that have content. (An images-before-content
flow is a later refinement, not slice 1.)

---

## §3 — Storage & lifecycle (device)

- **Location:** `<expo FileSystem.documentDirectory>/media/<bookId>/<id>.<ext>`.
  Book-scoped directory so deleting a book cascades its media in one `deleteAsync`.
- **Write path:** on attach, copy the picked/captured file into the media dir under a
  fresh id, strip metadata (§8), then append the ref to `topic.images`.
- **Delete path:** removing an image deletes the file **and** the ref (both, atomically
  from the user's view — ref removed in the store, file deleted best-effort after).
- **Orphan cleanup:** `saveBook` (`bookStore.ts:82`) is AsyncStorage-only (no FS), so
  media GC is a separate **async companion** `pruneOrphanMedia(book)` called alongside
  save: after the existing `content` prune, delete any file under `media/<bookId>/` not
  referenced by a surviving `TopicImage.file`. Guards against refs lost to a crash.
- **Caps (reuse ADR-028 Open Shelves storage-accounting pattern):**
  - mime allowlist: `image/jpeg`, `image/png`, `image/webp` only (reject others at pick).
  - per-image byte cap (e.g. 10 MB — exact value set in the plan).
  - per-topic image count cap (e.g. 20).
  - per-book total-media cap, surfaced in the storage/library view.
  - On any cap breach: reject the attach with a clear message ("what went wrong + how to
    fix" per ADR-034 copy honesty), do not partially write.

---

## §4 — Upload UX

- **New dependency:** `expo-image-picker` (gives both photo-library pick and camera
  capture). Not currently in `mobile/` (only `expo-document-picker` is). Add it; wire
  Android permissions (camera + media library) in the Expo config.
- **Affordance:** an **"Add figure"** control on the topic authoring surface (the screen
  that today shows generated content per topic). Tapping offers "Choose from library" /
  "Take photo".
- **After pick/capture:** copy → strip EXIF (§8) → append ref → prompt for an optional
  caption inline.
- **Figures management panel:** a list/grid of the topic's images (thumbnails) with
  per-image caption edit, reorder (drag or up/down), and delete. Order in the panel =
  render/compile order.
- **Voice (ADR-006):** "Add a figure to this topic," never "upload to AI" — nothing is
  sent anywhere in this slice. Copy must not imply processing (ADR-034 D3 storage ≠
  processing, applied even though no egress happens — keeps language honest and
  forward-compatible).
- **Web parity:** `expo-image-picker` on RN-web falls back to a file `<input>`; camera
  capture may be unavailable on web — degrade to library/file pick there. (Reader/compile
  are unaffected — they only consume refs.)

---

## §5 — Reader rendering (two render paths, kept in step)

There are **two** topic renderers, and they already mirror each other by design:
- **Web** — `mobile/src/reader/renderContent.ts` → `renderTopicToSafeHtml(topic)` (a
  **pure** function, single DOMPurify pass at the bottom; `NativeTopicReader.web.tsx:20`).
- **In-app / native** — `mobile/src/components/contentHtml.ts` `buildTopicHtml(...)`,
  rendered inside a WebView by `TopicRenderer`/`LessonRenderer.tsx`. Already carries
  `img { max-width:100% }` CSS (`contentHtml.ts:227`).

Both are **pure string builders — no I/O** — so neither can read image bytes itself. The
Figures block must be added to **both**, kept in step (a shared helper avoids drift).

**Design:** the caller resolves each `TopicImage.file` → a **data URL** (read the device
file as base64 via `expo-file-system`) and passes a `Map<imageId, dataUrl>` ("figure
resolver") into the builder. The builder emits a **Figures** `<figure>`/`<figcaption>`
block using those data URLs as `<img src>`. Resolution (I/O) stays in the impure caller
(a small `useTopicFigures(topic)` hook that reads files into the map); the builders stay
pure and unit-testable. `renderTopicToSafeHtml(topic, figures?)` gains an optional second
arg; `buildTopicHtml` likewise — absent ⇒ no Figures block (backward compatible).

- Figures block position: appended after the topic content (after Key takeaways),
  rendered only when `topic.images?.length`.
- **Security (reuse `mobile/src/reader/sanitize.ts`):** the `USE_PROFILES: { html }`
  config already permits `<img>`/`<figure>`/`<figcaption>` (a test pins that a
  `data:image/png` `src` survives the pass; add `<figure>`/`<figcaption>` to the profile
  only if the test shows they are stripped). `src` is **always** a `data:` URL we produced
  from a device file — **never a remote URL**. That is the whole image security surface: no
  `http(s)://` src ever reaches the sanitizer, so no tracking-pixel / SSRF / external fetch
  is possible. Captions are `escapeHtml`'d (plain text, not markdown).
- Alt text: `<img alt>` = the caption (or "" if none), for a11y parity with the EPUB.

---

## §6 — Compiled artifact: app inflates, compiler UNCHANGED

**Reality (from the codebase map):** the compiler is a **remote HTTP service**. The app
POSTs the whole `Book` as JSON (`mobile/src/api/client.ts:260`, `JSON.stringify(book)`)
to `POST /api/v1/export/jobs`; there is **no media channel** and no way to hand it a
`/media` directory. Images can only reach it as base64 `data:` URIs already inline in the
Book's markdown, which the existing `compiler/src/epub.ts:84 packImages()` extracts into
`OEBPS/images/img-NNN.ext`. **Chosen approach (A): the app inflates refs → data: URIs into
a transient copy of the Book at export time; the compiler needs no change and no redeploy.**

- **Two representations of a Book:**
  - *Stored* (AsyncStorage, `.book.json`): `topic.images` are **refs only** (§2). Bytes
    never in stored JSON.
  - *Compile payload* (transient, built in the export path, never persisted): a deep copy
    where, for each topic with images, a synthetic trailing **"Figures"** section is added
    to `lesson.sections` whose `body_markdown` is one `![Fig N. <caption>](data:<mime>;base64,…)`
    per image, in author order. `expo-image-manipulator`/`expo-file-system` produce the
    base64 (already EXIF-stripped on attach).
- The inflation lives in the export client seam (`mobile/src/lib/trackedExport.ts` /
  `mobile/src/api/client.ts exportBook`), applied to `epub` **and** `pdf` jobs alike (both
  take the same Book payload). `packImages()` handles EPUB packaging; the PDF path renders
  the same inline `<img data:>` markdown — no divergence, no compiler edit.
- Fidelity trade (accepted): captions ride as markdown alt text (`<img alt>`), not semantic
  `<figure>/<figcaption>`. `MEDIA_EXT` (`epub.ts:70`) already covers jpeg/png/webp; the
  compiler's existing `images.length>0 ⇒ visual access mode` (`epub.ts:307`) fires for free.
- **Not this slice:** first-class compiler `images[]` + semantic `<figure>` output (would
  need a compiler change + backend redeploy) — deferred as later polish.

---

## §7 — Export / import (bundle via fflate — already a dep)

Today a book exports as a single `.book.json` (`ExportBookJsonButton.tsx` →
`downloadTextArtifact`). With bytes off-JSON, export becomes a **zip bundle** built with
**`fflate`** — already a mobile dependency (`epubCover.ts:1` imports `unzipSync`), so no
new package. Delivery switches to the bytes writer `downloadArtifact` (`epubLibrary.ts:59`).

- **Export:** `fflate.zipSync({ "book.json": <utf8 bytes>, "media/<id>.ext": <file bytes>, … })`
  — only files still referenced by a surviving `TopicImage` (orphan-pruned first). Refs in
  `book.json` are rewritten to bundle-relative (`media/<id>.ext`) on the way out. Extension
  `.book.zip` (a legacy `.book.json` with no images may still take the plain-JSON path).
- **Import:** add a zip branch to `pickBookFile.ts` (mirror `pickEpubFile`, returning bytes)
  → `fflate.unzipSync` → `parseBook(book.json)` → for each media entry, re-validate (mime
  allowlist, byte cap, **re-strip EXIF** §8) and write to `media/<newBookId>/<id>.ext`, then
  rewrite each `TopicImage.file` to the new bookId path (import assigns a fresh id). A ref
  whose file is missing/invalid is dropped with a surfaced warning — never a dangling ref.
- Backward compat: a plain `.book.json` (no media) imports unchanged via the existing path.

---

## §8 — Security / privacy

- **Attach-only ⇒ safe by construction.** Images live on-device, are never sent to any
  model or server this slice → none of the ADR-034 gates (BAA/PHI, IP, DPA) fire. A short
  honest line in the UI ("your figures stay on your device") is warranted and sets up the
  later processing gate.
- **Strip metadata (EXIF) on import into the media dir.** A clinic/whiteboard/set photo can
  carry GPS + device data; **re-encode via `expo-image-manipulator`** (drops all EXIF incl.
  GPS) so the stored file and any exported bundle carry no location metadata. Applied on both
  attach (§3/§4) and bundle-import (§7). See Resolved decisions for the fallback.
- **Local-only `src` invariant** (§5): the reader's image `src` is always a `data:` URL
  from a device file — never remote. This is asserted in tests over the rendered/parsed DOM.
- Caps + mime allowlist (§3) bound resource use and reject non-image payloads at the door.

---

## §9 — Testing

- **Schema:** `TopicImage` round-trips through the book store (save/load) with refs intact;
  compiler `BookMetadata`/type mirror stays aligned.
- **Storage lifecycle:** attach writes a file + ref; delete removes both; deleting a book
  cascades its media dir; orphan prune deletes an unreferenced file; each cap
  (per-image / per-topic / per-book / mime) rejects cleanly with no partial write.
- **Reader (both paths):** `renderTopicToSafeHtml(topic, figures)` and `buildTopicHtml(...,
  figures)` each emit a Figures block; captions are escaped; **every `<img src>` in the
  parsed output is a `data:` URL** (assert over the DOM, per the local-only invariant); no
  Figures block when `images` empty or no resolver passed.
- **Compile inflation (app-side, pure):** the payload builder turns a topic with an image
  ref into a **transient** copy carrying a trailing "Figures" section whose `body_markdown`
  is `![Fig 1. cap](data:…)`; assert the **stored** book is untouched (refs only, no data:
  URI) and the payload's markdown carries the data: URI in author order. (The remote
  compiler is unchanged; `packImages` extraction is already covered by compiler tests.)
- **Export/import round-trip:** a book with an image exports to a `.book.zip` bundle
  (fflate) and re-imports with the image byte-identical (modulo the deliberate EXIF strip)
  and the ref rewritten to the new bookId; a plain legacy `.book.json` still imports.
- **EXIF:** a fixture image with GPS EXIF has that metadata absent after attach/import.
- Coverage: mobile RNTL/jest for store + UX; pure jsdom-jest for the reader builders and the
  payload builder. (No live services — CLAUDE.md testing rule.)

---

## §10 — Docs, ADR & help

- **Help (Definition of Done, CLAUDE.md):** shipping the attach UX means adding a `FEATURES`
  key in `mobile/src/help-content/features.ts` + a `HelpTopic` with that `featureKey` in
  `mobile/src/help-content/topics.ts`, in the same PR — the coverage gate
  (`mobile/__tests__/help/coverage.test.ts` → `uncoveredFeatures`) enforces it.
- **SCOPE.md:** this slice introduces the **author-supplied media class** + a device blob
  layer; note it amends the "defer rich media" posture for images (attach-only).
- **ADR:** slice 1 does not need its own ADR (it is a free, device-local extension consistent
  with ADR-003/014). The design records that it is **slice 1 of a media feature**; the later
  *processing* slice — where raw media would be sent for vision/OCR — is where a dedicated ADR
  and ADR-034's stricter gates land. A one-line pointer is added to the media context so the
  processing slice is not mistaken for shipped.

---

## Open questions (for the plan, not blockers)

1. **Exact cap values** (per-image bytes, per-topic count, per-book total). *TBD — set in
   the implementation plan.*
3. **PDF figure path.** Whether the PDF renderer already shares the EPUB XHTML assembly
   (reuse for free) or needs a small figure-embed addition. *TBD — confirm during
   implementation.*

## Resolved decisions

- **EXIF / metadata strip (was Q2).** Use `expo-image-manipulator` to re-encode every
  attached/imported image (a format/quality pass) — this drops **all** EXIF, including the
  privacy-critical **GPS coordinates** and device identifiers, and is available under Expo
  without a heavy native dependency. Rationale for not using a timestamp-only fallback: the
  real disclosure risk is embedded **location**, which a "set to system date/time" step would
  not remove. If (and only if) a re-encode is ever unavailable on a platform, degrade to
  stripping the EXIF/APPn segments and, at minimum, overwrite the timestamp with the system
  date/time — never ship the original GPS-bearing metadata.
- **Attach only where content exists (was Q4).** Images attach only to a topic that already
  has a `GeneratedTopic`. No images-before-content flow in slice 1. The "Add figure"
  affordance is shown only on topics with content.
