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

**Refs only — bytes never in `book.json`.** The JSON holds a lightweight ref; bytes
live in device file storage (§3). This keeps `book.json` small, fast to load/save, and
cheap for the (later) hosted-sync slice to reason about.

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
- **Orphan cleanup:** on book save, after `content` pruning, delete any file under
  `media/<bookId>/` not referenced by a surviving `TopicImage.file` (mirrors the
  existing orphaned-`GeneratedTopic` prune). Guards against refs lost to a crash.
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

## §5 — Reader rendering

The native web reader builds one sanitized HTML fragment per topic
(`mobile/src/reader/renderContent.ts` → `renderTopicToSafeHtml`, single DOMPurify pass
at the bottom). `renderContent.ts` is **pure — no React, no I/O** — so it cannot read
image bytes itself.

**Design:** the caller resolves each `TopicImage.file` → a displayable **data URL**
(read the device file as base64 via `expo-file-system`) and passes a
`Map<imageId, dataUrl>` (a "figure resolver") into `renderTopicToSafeHtml`. The renderer
emits a **Figures** `<figure>`/`<figcaption>` block using those data URLs as `<img src>`.
Resolution (I/O) stays in the impure caller; the renderer stays pure and unit-testable.

- Figures block position: appended after the topic content (after Key takeaways),
  rendered only when `topic.images?.length`.
- **Security (reuse `mobile/src/reader/sanitize.ts`):** the existing `html` profile
  already permits `<img>`, `<figure>`, `<figcaption>` (confirm `<figure>`/`<figcaption>`
  are in the allowlist; add if missing). `src` is **always** a `data:` URL we produced
  from a device file — **never a remote URL**. This is the whole image security surface:
  no `http(s)://` src ever reaches the sanitizer, so no tracking-pixel / SSRF / external
  fetch is possible. Captions are `escapeHtml`'d (plain text, not markdown).
- Alt text: `<img alt>` = the caption (or "" if none), for a11y parity with the EPUB.

---

## §6 — Compiler (the paid artifact stays free to produce)

The Node compiler already extracts `data:image/…;base64,…` `src`s from chapter XHTML
into packaged EPUB manifest resources — `compiler/src/epub.ts:84 packImages()` (used
today for cover/logo). Slice 1 **reuses this path**:

- The compile input carries `book.json` **+ the media files** (the caller hands the
  compiler the `media/<bookId>/` directory alongside the book).
- For each `topic.images` ref, the compiler reads the file, base64-encodes it, and emits
  a `<figure><img src="data:…"><figcaption>…</figcaption></figure>` into that topic's
  chapter XHTML. `packImages()` then pulls the data URI into an `ImageRes` manifest entry
  and rewrites the `src` to `../images/img-NNN.ext` — no new packaging code needed.
- The `MEDIA_EXT` map (`epub.ts:70`) already covers jpeg/png/webp — aligned with the §3
  allowlist.
- **PDF path:** the PDF renderer consumes the same XHTML with inline `data:` `<img>` (it
  does not require manifest extraction). Confirm the PDF branch embeds the figure images;
  add if the PDF path diverges from EPUB XHTML assembly.
- Captions become `<figcaption>`; alt text carried for EPUB Accessibility 1.1 metadata
  (the compiler already derives a11y access modes — attached images add `visual` to
  `accessMode`).

---

## §7 — Export / import (the lifecycle cost we accepted)

Today a book exports as a single `.book.json`. With bytes now off-JSON, export becomes a
**bundle**:

- **Export:** a zip containing `book.json` + a `media/` folder (the referenced files
  only — orphan-pruned first). Refs inside `book.json` stay device-relative
  (`media/<bookId>/<id>.ext`).
- **Import:** unzip → restore files under `media/<newBookId>/` → rewrite each
  `TopicImage.file` to the new bookId path (import assigns a fresh book id). Validate each
  media file on import: mime in allowlist, within byte cap, re-strip EXIF (§8). A ref with
  a missing/invalid file is dropped with a surfaced warning — import never silently keeps a
  dangling ref.
- Backward compat: a legacy plain-`.book.json` (no media) imports unchanged — absence of a
  `media/` entry ⇒ zero images.

---

## §8 — Security / privacy

- **Attach-only ⇒ safe by construction.** Images live on-device, are never sent to any
  model or server this slice → none of the ADR-034 gates (BAA/PHI, IP, DPA) fire. A short
  honest line in the UI ("your figures stay on your device") is warranted and sets up the
  later processing gate.
- **Strip metadata (EXIF) on import into the media dir.** A clinic/whiteboard/set photo can
  carry GPS + device data; re-encode (or strip the EXIF/APP segments) so the stored file and
  any exported bundle carry no location metadata. Applied on both attach (§3/§4) and
  bundle-import (§7).
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
- **Reader:** `renderTopicToSafeHtml` with a figure-resolver map emits a Figures block;
  captions are escaped; **every `<img src>` in the parsed output is a `data:` URL** (assert
  over the DOM, per the local-only invariant); no figures block when `images` empty.
- **Compiler:** a topic with one image compiles to an EPUB whose manifest contains the
  packaged `images/img-001.<ext>` resource and whose chapter XHTML references it; PDF embeds
  the figure.
- **Export/import round-trip:** a book with an image exports to a bundle and re-imports with
  the image byte-identical (modulo the deliberate EXIF strip) and the ref rewritten to the
  new bookId.
- **EXIF:** a fixture image with GPS EXIF has that metadata absent after attach/import.
- Coverage: mobile RNTL/jest for store + UX; pure jsdom-jest for `renderContent`; compiler
  jest for `packImages` integration. (No live services — CLAUDE.md testing rule.)

---

## §10 — Docs, ADR & help

- **Help (Definition of Done, CLAUDE.md):** shipping the attach UX means adding a `FEATURES`
  key + a Help topic (`mobile/src/constants/helpContent.ts`) in the same PR — the coverage
  gate enforces it.
- **SCOPE.md:** this slice introduces the **author-supplied media class** + a device blob
  layer; note it amends the "defer rich media" posture for images (attach-only).
- **ADR:** slice 1 does not need its own ADR (it is a free, device-local extension consistent
  with ADR-003/014). The design records that it is **slice 1 of a media feature**; the later
  *processing* slice — where raw media would be sent for vision/OCR — is where a dedicated ADR
  and ADR-034's stricter gates land. A one-line pointer is added to the media context so the
  processing slice is not mistaken for shipped.

---

## Open questions (for the plan, not blockers)

1. Exact cap values (per-image bytes, per-topic count, per-book total).
2. EXIF strip mechanism on-device (re-encode via an image lib vs. segment strip) — pick the
   lightest reliable option available under Expo without adding heavy native deps.
3. Whether the PDF path already shares the EPUB XHTML assembly (reuse) or needs a small
   figure-embed addition (confirm during implementation).
4. Whether to allow images on a topic that has no generated `GeneratedTopic` yet (slice 1
   default: no — attach only where content exists).
