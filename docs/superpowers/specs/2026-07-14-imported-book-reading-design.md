# Imported Book Reading (F1) — Design

**Date:** 2026-07-14 · **revised 2026-07-16** (three load-bearing assumptions were falsified
against the code before planning — see *Revision note*)
**Status:** Proposed
**Branch:** `feat/open-shelves` (localhost-only; not merged to main)
**Related:** ADR-028 (Open Shelves), ADR-004 (two-product split), ADR-017 (bundled
default library), `docs/specs/open-shelves-spec.md`

## Revision note (2026-07-16)

This spec was written on 2026-07-14 and checked against the code before a plan was drafted. Three
of its assumptions were wrong. They are corrected in place below; the goal, the threat model, and
the F1/F2/F3 decomposition all survive unchanged.

| Original claim | Reality | Where corrected |
|---|---|---|
| "New dependency: a pure-JS zip reader (`jszip` or equivalent)… a deliberate, spec-level dependency addition" | **`fflate` is already a dependency**, and `src/storage/epubCover.ts` **already unzips EPUBs and resolves `META-INF/container.xml` → OPF → manifest** ("Pure JS (fflate) — no native deps") | A-I1 |
| "Reuse the existing DOMPurify boundary… sanitize at import; store sanitized" | `src/reader/sanitize.ts` is **web-only** — its header reads *"DOMPurify needs a DOM. Never import this from a non-`.web` module."* **Hermes has no DOM**, so this cannot run at import on Android. The native path has **no sanitizer at all**. | D-I4, A-I3, Security |
| Goal: "renders well, **offline**, on Android" | The native reader loads marked/KaTeX/Mermaid from **`cdn.jsdelivr.net` with no fallback**, and throws on its first statement without them — **it renders nothing offline today** (issue **#325**). F1 inherits this: an imported book that needs a CDN to open is not an offline book. | D-I6 (new), Dependencies |

The lesson generalises: this spec's own rule — *"reuse it; do not write a second sanitizer"* — applies
equally to the EPUB parser (`epubCover.ts` already exists) and is what makes the native sanitize
problem hard rather than convenient to ignore.

**Branch prerequisite.** `feat/open-shelves` is **41 commits behind `main`** and must merge it before
F1 starts. F1 depends on work that only exists on `main`: `RENDER_HELPERS_JS` is **exported** (#324),
which is what lets a jest test execute the WebView's JS and assert the native sanitizer for real —
without it, D-I4's native half cannot be tested at all. (`npm install` on the branch too: 3 suites
currently fail to load because `fast-xml-parser` is declared but not installed.)

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

### D-I4: Parse once at import; sanitize at the render boundary *(revised 2026-07-16)*

Unzip and normalize at **import** time; store the result. Opening is then
instant, the reader needs no zip knowledge, and **F2 finds the book's text
already in the store**. Import becomes the slow step and carries a progress
state. A malformed or hostile EPUB fails **loudly at import, never mid-read**.

> **Revised: "store *sanitized*" was not implementable on Android.** The original
> text said sanitize at import and store the sanitized HTML, reusing the existing
> DOMPurify boundary. But `sanitize.ts` is **web-only** — *"DOMPurify needs a DOM.
> Never import this from a non-`.web` module"* — and **Hermes has no DOM**. There
> is no import-time sanitizer on the platform the product ships on.

What import **does** do (pure JS, works on Hermes and web):

- unzip, resolve the OPF/spine, extract each chapter's XHTML;
- **inline images from inside the zip** as `data:` URIs and **drop every remote
  reference**, so opening a book cannot phone home (this is a *reference-rewrite*,
  not sanitization, and needs no DOM);
- enforce the caps and refusals (zip bomb, traversal, DRM) — all pure checks.

**Sanitization happens at the render boundary, in the DOM that actually exists:**

- **Web:** the existing `sanitizeFragment` (`src/reader/sanitize.ts`) via
  `renderContent.ts`, exactly as today.
- **Native:** DOMPurify **inside the WebView**, which *does* have a DOM. This is
  the same library and the same profile — **not a second sanitizer**. The
  untrusted chapter travels into the WebView as a **JSON string** (as all reader
  data already does) and is sanitized **before** it is ever assigned to
  `innerHTML`, so nothing in it is parsed as HTML while unsanitized.

**Consequence to accept honestly:** the read path can no longer be "dumb" — the
guarantee moved from *stored bytes are safe* to *the render boundary is the only
way in*. That must be enforced by tests on both surfaces, not by convention.

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

### D-I6: The WebView must be self-contained *(added 2026-07-16)*

F1's goal says an imported book reads **offline**. The native reader currently
loads marked/KaTeX/Mermaid from `cdn.jsdelivr.net` with no fallback and throws
without them (**issue #325** — it renders nothing offline today, for generated
content too).

So F1 **cannot** put DOMPurify in the WebView via a CDN tag: an imported
public-domain book that needs a network to open defeats the entire point of
downloading it. DOMPurify must be **inlined into the WebView document** (it is
already an npm dependency — the bytes are local, only the delivery is remote).

This makes **#325 a prerequisite or a companion**, not an unrelated bug: the
mechanism F1 needs (self-contained WebView renderers) is the same one #325 needs.
Imported chapters are already HTML and need no marked/KaTeX to render, so F1
could in principle inline *only* DOMPurify — but fixing #325 properly and reusing
its mechanism is the cleaner order.

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

**No new dependency, and no second parser.** `fflate` is already a dependency and
`src/storage/epubCover.ts` already does the front half of this job — `unzipSync`,
then `META-INF/container.xml` → OPF → manifest lookup, pure JS on both Hermes and
web. `epubReader.ts` **extends that resolution rather than duplicating it**: the
container/OPF walk is factored out of `epubCover.ts` and shared, so the cover
extractor and the reader can never disagree about what a book's OPF says.

(The original spec called for adding `jszip`. That was written without checking:
the capability was already in the tree.)

### A-I2: `epubToBook.ts` — the mapping (pure)

- `epubToBook(parsed: ParsedEpub, opts): { book: Book; chapters: Record<string, ImportedChapter> }`
- The **spine maps onto the existing `StructuredTOC`**: each spine item becomes a
  `TopicNode`. So the Library, the book list, the TOC drawer, and progress all
  work unchanged.
- Pure function, no I/O — the easiest unit to test hard.

### A-I3: `importEpub.ts` — the orchestration

- `importEpub(bytes, origin): Promise<Book>` — read → **rewrite references**
  (inline zip images, drop remote refs) → map → persist via the existing book
  store. *(Revised: sanitization moved to the render boundary — D-I4. Import does
  the DOM-free work; it cannot sanitize on Hermes.)*
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
(ADR-028). DOMPurify is the *whole* boundary — reuse it; **do not write a second
sanitizer.**

*(Revised 2026-07-16: that boundary exists **only on web** today —
`src/reader/sanitize.ts` is web-only and the native path has **no sanitizer at
all**, rendering into a WebView with `javaScriptEnabled`, `originWhitelist={["*"]}`
and `mixedContentMode="always"`. That is tolerable for our own generated content
and is **not** tolerable for a third-party EPUB. D-I4 puts the same DOMPurify,
same profile, inside the WebView — the one place on native that has a DOM.)*

| Threat | Control |
|---|---|
| Scripted XHTML (`<script>`, `onerror=`, `javascript:` href) | Every chapter through the existing DOMPurify profile — on web via `sanitizeFragment`, on native via **DOMPurify inlined in the WebView** (D-I4). The chapter crosses into the WebView as a **JSON string** and is sanitized **before** any `innerHTML` assignment, so it is never parsed as HTML unsanitized. Asserted on **both** surfaces. |
| CSS exfiltration / overlay | **EPUB CSS dropped entirely** (D-I3). No `style` passthrough. |
| Phone-home on open | **Images resolve only from inside the zip.** A remote `src` is **dropped, not fetched** — otherwise opening a book leaks the reader's IP and reading activity to whoever made it. This is a reference-rewrite done **at import** (no DOM needed), belt-and-braces with the sanitizer's own URL rules at render. Tests spy on fetch and assert it is never called. |
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
| **Scripts are stripped — on BOTH surfaces** | chapter with `<script>` + `onerror` → sanitized, asserted over the parsed DOM. Must be asserted for **web (`sanitizeFragment`) and native (DOMPurify in the WebView)** — sanitization now lives at the render boundary (D-I4), so a test on one surface proves nothing about the other. The WebView's JS can be executed in jest (see `__tests__/lib/figureAltText.test.ts`, which runs the exported `RENDER_HELPERS_JS` directly). |
| **No phone-home** | chapter with a remote `<img src="https://…">` → dropped at import, and **fetch is never called** (spied) |
| **Opens offline** | an imported book renders with **no network** — the reason #325 is a prerequisite (D-I6). Assert by executing the reader JS with the CDN globals absent, as #325's repro does. |
| **Zip bomb refused** | oversized inflate → import fails, nothing persisted |
| **Path traversal refused** | `../../etc/passwd` entry → rejected |
| DRM refused | `encryption.xml` → clear error |
| Import is atomic | a parse failure mid-way persists no book |
| Pure mapping | `epubToBook` unit tests, no I/O |

No network in CI (repo rule).

## Definition of Done

Add the feature key to `FEATURES` in **`mobile/src/help-content/features.ts`**
plus a Help topic with that key, in the same PR. The coverage gate
(`mobile/__tests__/help/coverage.test.ts`) fails otherwise.

*(Corrected 2026-07-16: the original said `mobile/src/constants/helpContent.ts`,
copied from `CLAUDE.md`. **That path does not exist** — the file is
`src/help-content/features.ts`. CLAUDE.md carries the same stale path and should
be fixed separately.)*

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
