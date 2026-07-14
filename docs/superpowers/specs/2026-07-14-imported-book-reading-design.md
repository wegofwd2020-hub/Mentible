# Imported Book Reading (F1) — Design

**Date:** 2026-07-14
**Status:** Proposed
**Branch:** `feat/open-shelves` (localhost-only; not merged to main)
**Related:** ADR-028 (Open Shelves), ADR-004 (two-product split), ADR-017 (bundled
default library), `docs/specs/open-shelves-spec.md`

## The problem

**Open Shelves currently has no read path.** The Downloads screen's only actions
are *Delete* and *Delete all*. There is no Open, no Read. The Library and the
reader contain zero references to shelf downloads, and generation cannot take an
imported book as input.

The complete user journey today is: browse a catalog → download an EPUB to
device storage → delete it.

So the honest statement of the gap is not "users may not understand why
importing is useful." It is: **importing is not yet useful.** This feature makes
an imported book readable inside Mentible, which is the precondition for every
downstream idea (see Follow-ups: F2, F3).

## Goal

A book downloaded from Open Shelves appears in the Library and opens in the
Mentible reader, rendering well, offline, on Android and web.

## Decisions

### D-I1: Parse the EPUB into our own reader

Rejected: handing the file to the device's EPUB app (nearly free, but the user
leaves Mentible, we never hold the text, and generating from the book — the
entire strategic point — is foreclosed).

We add EPUB capability: unzip, parse, and render the book's XHTML through the
reader's existing sanitize + style layers. Because we then hold the text,
**F2 (generate study material from an imported book) becomes possible.** That is
the reason this option is worth its cost.

### D-I2: An imported book is first-class in the Library

It appears alongside authored and bundled books, with an origin badge. This
matches the Personal-Library north star (one shelf; your books, whatever their
source) and gives F2 a single uniform target.

`Book` already carries `source?: BookSource` — its comment reads *"Absent ⇒
user-authored/imported"* — so the model anticipated this.

### D-I3: Our typography, images kept, EPUB CSS dropped

Render the chapter's semantic HTML (headings, paragraphs, lists, blockquotes,
tables) in Mentible's reader styles. **Images are kept** — resolved from inside
the zip, inlined as `data:` URIs — so covers and illustrated books render (the
multi-modal library is the product thesis; a blank gap where a plate should be
undercuts it).

**The EPUB's own CSS is dropped.** Honoring it would mean letting `style`/CSS
from untrusted content through the sanitizer, and CSS carries real
exfiltration and overlay tricks. For public-domain texts the original styling is
usually negligible, and our typography reads better than most of it.

### D-I4: Parse once at import; store sanitized chapters

Unzip, sanitize, and normalize at **import** time; store the result. Opening is
then instant, the reader needs no zip knowledge, and **F2 finds the book's text
already in the store**. Import becomes the slow step and carries a progress
state. A malformed or hostile EPUB therefore fails **loudly at import, never
mid-read**.

Cost: roughly the book's size again in storage. The original `.epub` is **not**
retained (that would double storage against the ~100-unit fair-use cap, D18).

### D-I5: Web imports from a file picker, not from the download

**On web we never hold the file.** Web downloads are fire-and-forget through the
browser (`browserDownload`), and re-fetching the EPUB from JS is blocked by CORS.
Routing book *content* through our backend is **forbidden** — ADR-028 D2: our
infra never hosts, mirrors, or proxies a third-party book file. The
`/api/v1/shelves/feed` proxy is metadata-only and must stay that way.

Therefore:

- **Native (Android):** import directly from the downloaded file (the download
  engine already writes it to device storage and verifies it).
- **Web:** an **"Import an EPUB" file picker** — the user selects the `.epub`
  they downloaded (or any EPUB they own). Honest, needs no proxy, and has the
  side benefit of accepting books that never came from Open Shelves at all.

The parse/sanitize/store pipeline below is identical on both platforms; only the
*bytes source* differs. That seam is the only platform branch.

## Architecture

Four units. Each is independently testable; only the last touches the app.

### A-I1: `epubReader.ts` — the format

- `readEpub(bytes: Uint8Array): Promise<ParsedEpub>` where
  `ParsedEpub = { metadata: { title, authors, language, cover? }, spine: SpineItem[] }`
  and `SpineItem = { id, title, html: string, images: Map<path, bytes> }`.
- Unzips; reads `META-INF/container.xml` → the OPF; reads the OPF's metadata,
  manifest, and spine order; pulls each spine document and its referenced
  images.
- Knows nothing about Mentible. Pure format code.
- Refuses an encrypted/DRM'd book (`META-INF/encryption.xml` present) with a
  clear error rather than rendering garbage.

New dependency: a pure-JS zip reader (`jszip` or equivalent) — it must work on
both Hermes and web. This is a deliberate, spec-level dependency addition.

### A-I2: `epubToBook.ts` — the mapping (pure)

- `epubToBook(parsed: ParsedEpub, opts): { book: Book; chapters: Record<string, ImportedChapter> }`
- The **spine maps onto the existing `StructuredTOC`**: each spine item becomes a
  `TopicNode`. So the Library, the book list, the TOC drawer, and progress all
  work unchanged.
- Pure function, no I/O — the easiest unit to test hard.

### A-I3: `importEpub.ts` — the orchestration

- `importEpub(bytes, origin): Promise<Book>` — read → sanitize each chapter →
  map → persist via the existing book store.
- The one slow step; exposes a progress state (parsing / N of M chapters).
- Failure is atomic: **a failed import persists nothing.** (Same discipline as
  `addSource`: validate and parse fully before touching the store.)

### A-I4: Reader + Library integration

- `Book.source: "imported"` joins the existing `"bundled"`; drives the origin
  badge in the Library.
- **`Book.chapters?: Record<string, ImportedChapter>`** — a *separate* map from
  the existing `content?: Record<string, GeneratedTopic>`.

  Reusing `content` is the tempting shortcut and it is wrong: `GeneratedTopic`
  means *LLM-generated, schema-validated* material. An imported chapter is
  neither. Two fields, two meanings — no lying to the type system.
- The reader renders an `ImportedChapter`'s already-sanitized HTML instead of
  running the markdown pipeline. Same styles, same sanitize boundary.
- Downloads screen gains **Open** (native) and the Shelves screen gains
  **Import an EPUB** (web).

## Security — untrusted content, treated as such

An EPUB from an arbitrary catalog is hostile input, exactly like feed XML
(ADR-028). The reader's DOMPurify boundary is the *whole* boundary
(`src/reader/sanitize.ts`) — reuse it; **do not write a second sanitizer.**

| Threat | Control |
|---|---|
| Scripted XHTML (`<script>`, `onerror=`, `javascript:` href) | Every chapter through the existing DOMPurify profile. **Sanitize at import; store sanitized**, so the read path cannot get it wrong later. |
| CSS exfiltration / overlay | **EPUB CSS dropped entirely** (D-I3). No `style` passthrough. |
| Phone-home on open | **Images resolve only from inside the zip.** A remote `src` is **dropped, not fetched** — otherwise opening a book leaks the reader's IP and reading activity to whoever made it. Tests spy on fetch and assert it is never called. |
| Zip bomb | Caps: entry count, per-entry inflated size, total inflated size. Exceeding a cap fails the import. |
| Path traversal (`../`) in zip entries | Rejected. Nothing is written outside the book's own storage. |
| DRM / encrypted EPUB | Detected and refused with a clear message. |

## Error handling

- **Malformed / hostile EPUB:** import fails with a specific message; nothing is
  persisted; the downloaded file is kept so the user can retry or delete it.
- **Import interrupted (app killed mid-import):** no partial book — the book is
  written only after the full parse succeeds.
- **A chapter that sanitizes to nothing:** kept as an empty chapter rather than
  dropped, so the TOC still matches the book's real structure.

## Testing

Real fixtures, not mocks — a small hand-built EPUB checked into the repo:

| Guarantee | Test |
|---|---|
| A normal EPUB imports and reads | spine → TOC, chapters render, images inline |
| Nested TOC is preserved | multi-level spine → `StructuredTOC` |
| **Scripts are stripped** | chapter with `<script>` + `onerror` → sanitized, asserted over the parsed DOM |
| **No phone-home** | chapter with a remote `<img src="https://…">` → dropped, and **fetch is never called** (spied) |
| **Zip bomb refused** | oversized inflate → import fails, nothing persisted |
| **Path traversal refused** | `../../etc/passwd` entry → rejected |
| DRM refused | `encryption.xml` → clear error |
| Import is atomic | a parse failure mid-way persists no book |
| Pure mapping | `epubToBook` unit tests, no I/O |

No network in CI (repo rule).

## Definition of Done

Per `CLAUDE.md`: add the feature key to `FEATURES` in
`mobile/src/constants/helpContent.ts` plus a Help topic with that key, in the
same PR. The coverage gate (`mobile/__tests__/help/coverage.test.ts`) fails
otherwise.

## Out of scope (deliberately)

- **Reflowable pagination**, font/size/theme controls, footnote popups, audio or
  media overlays, EPUB CSS.
- **F2 — generating from an imported book.** This feature ends when an imported
  book opens and reads well. F2 is what makes it *matter*, and gets its own spec.
- **F3 — the advertisement.** Teaching users that any OPDS catalog works, and
  what happens when they bring a book in. Only honest once F1 ships; only
  compelling once F2 does.
- Re-export or sharing of the original `.epub` (we do not retain it — D-I4).

## Follow-ups

- **F2 (the payoff):** what Mentible does with an imported book that a plain
  EPUB reader cannot — generate a study guide, per-chapter quizzes, or light it
  up in the rich reader. This is the moat and the real answer to "why import?"
  D-I4 deliberately leaves the book's text sitting in the store to make it
  straightforward.
- **F3 (the advertisement):** capability discovery (any OPDS feed works) plus a
  value story for import.
- PDF import — the same shape, a different parser. Not now.
