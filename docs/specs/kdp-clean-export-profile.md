# KDP-Clean EPUB Export Profile — Design Spec

**Status:** Proposed · **Date:** 2026-07-21 · **Tracks:** issue #336 (workstream B)
**Scope:** a `kdp` export profile in the `compiler/` package that produces an EPUB3 which ingests cleanly on Amazon KDP and passes validation. **eBook only** — KDP's reflowable eBook target is EPUB; the PDF path is a separate print/paperback concern (out of scope, see Non-goals).

## Why

Mentible already emits EPUB3 (`compileEpub`, `compiler/src/epub.ts`) via a hand-rolled JSZip packager. It's ~80% KDP-ready, but three choices the current single-shape compiler makes are wrong for Kindle. This adds a distribution-target *profile* rather than a second compiler.

## Already satisfied — NO work (corrects issue #336)

Verified against the code; the ticket over-scoped these:

- **Logical TOC** — `buildNav()` (`epub.ts:250`, EPUB3 `nav.xhtml`, subject-grouped) **and** `buildNcx()` (`epub.ts:225`, EPUB2 `toc.ncx`) are both already emitted. ✅
- **Title page + front matter** — generated in `compileEpub` (title page, colophon, List of Figures/Tables, glossary). ✅
- **No headers/footers/page-numbers** — the EPUB is reflowable by construction; those only apply to the paged PDF. ✅
- **Cover aspect ratio** — `buildCoverSvg` uses `viewBox="0 0 1600 2560"` (`cover.ts:15`) = exactly KDP's ideal **1.6:1** portrait. ✅ (ratio; *format* still needs fixing — D5.)

## The real deltas

### D1 — Profile plumbing (net-new)
No profile/variant concept exists. `CompileOptions` (`epub.ts:41`) is only `{ diagrams?, mermaid? }`. Add:

```ts
// compiler/src/epub.ts
export interface CompileOptions {
  diagrams?: DiagramRenderer;
  mermaid?: MermaidRenderer;
  profile?: "default" | "kdp";   // NEW — default "default"
}
```

Thread it end-to-end the way `--mermaid`/`diagrams` already threads (the proven seam):
1. `compiler/src/cli.ts` — new `--profile kdp` flag → passes into `compileEpub`.
2. `backend/src/export/compiler.py` (`compile_book`) — append `--profile` to the subprocess argv.
3. `backend/src/export/router.py` — accept `profile` on `POST /export` and `POST /export/jobs`.
4. `mobile/src/api/client.ts` (`exportBook`/`publishBook`) — pass the option through.
5. UI — a distinct **"Export for Kindle (KDP)"** action (see Open Questions), not a change to the default Save-to-Library.

Precedent: `BookMetadata.status` → `release.ts` watermarking shows the "a flag changes output, not a new renderer" pattern. We use a compile-time *option* (not a `metadata` field) because KDP-clean is a distribution-target choice made at export, not an authored property of the book.

### D2 — KDP body stylesheet (net-new)
`css.ts`'s `STYLESHEET` forces reflowable **body** typography, which KDP disallows:
- `body { font-family: ${SERIF}; line-height: 1.7; … }` (`css.ts:24`) with `SERIF = "Liberation Serif", "Source Serif 4", …`,
- and it **embeds** `Source Serif 4` as a base64 `@font-face` (`fonts.ts:SOURCE_SERIF_FONTFACE`, injected at `css.ts:22`) — forcing, not suggesting, a body font.

Add `KDP_STYLESHEET` (or parametrize the module) that, for `profile: "kdp"`:
- **drops** the `@font-face` embed and the `font-family` + `line-height` on `body` → reading-system defaults control body typography;
- **keeps** heading/decorative/class styles (allowed and encouraged for headings, special paragraphs, tables, figures).
`compileEpub` selects it at the stylesheet write (`epub.ts:210`).

### D3 — Math → raster (net-new · biggest item)
`renderMarkdown` emits **inline MathML** (`marked-katex-extension`, `output: "mathml"`, `markdown.ts:22`). Kindle MathML support is partial/inconsistent → equations break on some devices.

KDP variant: replace each equation with a rasterized `<img class="math" alt="<LaTeX source>">`.
- New module `compiler/src/mathRaster.ts`, mirroring the batched single-browser pattern of `mermaid.ts` + the screenshot approach of `coverRaster.ts`: collect all math book-wide, render once in one headless-Chromium page, screenshot each to PNG, replace inline.
- **`alt` = the original LaTeX** (preserve accessibility — KDP a11y; the current `accessibilityMeta()` MathML feature must flip to a textual-alternative mode for this profile, `epub.ts:307`).
- Packaging is free: `packImages()` (`epub.ts:84`) already extracts data-URI images into `OEBPS/images/…`.
- Trade-off: raster math loses reflow scaling + selection, but renders reliably. Standard Kindle practice.

### D4 — Diagrams → raster (net-new · reuses existing Puppeteer)
`PrerenderedDiagramRenderer` (`diagrams.ts:48`) **inlines the Mermaid SVG** in `<figure class="diagram">`. Kindle SVG support is limited (no scripting, spotty features).

KDP variant: a `PrerenderedRasterDiagramRenderer` that rasterizes the SVG to PNG. `mermaid.ts` already runs Puppeteer with the rendered SVG in the DOM — add a screenshot-to-PNG step (same technique as `coverRaster.ts`), emit `<img>` inside the figure. Reuse the one-browser-per-book batch. Selected when `profile: "kdp"`.

### D5 — Cover → raster cover-image (modification · reuses `coverRaster.ts`)
The OPF registers `cover.svg` (`image/svg+xml`, `properties="cover-image"`, `epub.ts:351`). KDP wants a **raster** cover (JPEG, RGB). `coverRaster.ts` (`renderCoverPng`) already rasterizes the cover SVG (at 420px for the app thumbnail).
- For `kdp`: rasterize at full **1600×2560** to **JPEG**, register *that* as `cover-image` (keep `cover.xhtml` pointing at the raster).
- Small change: extend `coverRaster` to emit JPEG at target size; `buildOpf` picks the raster cover for the profile.

### D6 — Metadata completeness (mostly upstream)
The OPF/colophon emitters are already strong — `buildOpf` (`epub.ts:376`) emits `dc:title`/`dc:language`/`dc:identifier`, `dc:creator` with a `marc:relators` `aut` role + `file-as`, `dc:publisher`/`dc:date`/`dc:description`/`dc:subject`/`dc:rights`, and the EPUB3-required `dcterms:modified` timestamp; `colophonSection` (`colophon.ts`) renders a real `epub:type="copyright-page"` with a graceful `© <year> <holder>` rights fallback. **The risk is the input, not the emitter** — every field except the © fallback is conditional on `book.metadata` being populated. For KDP-clean:

- **Capture `author` upstream.** `dc:creator` + the colophon byline only appear when `metadata.author` is set. Verify the authoring flow (New Book / Book Editor, `mobile/src/components/BookEditor.tsx`) records an author (default from the signed-in account) — the editor exposes title/description/tags but no visible author field. An author-less EPUB forces the writer to type it into KDP's form. *(May be a mobile-side change, outside `compiler/`.)*
- **Normalize `dc:date` to ISO 8601** (`YYYY-MM-DD`) in `buildOpf`. It's currently passed through as a raw string; epubcheck (V) warns on non-ISO `dc:date`. `dcterms:modified` is already correct.
- **Translator role for translations.** Add a `dc:contributor` with `marc:relators` `trl` when the book is a translation (ties to the AI-translation disclosure, #336-A). Requires a `metadata.translator` field. Gap only for the translated case.
- **Release-status guard.** Exporting `profile: "kdp"` must imply/require `status: "release"` — a draft prints `"— not for distribution"` in the colophon (`isDraft`, `release.ts`). Either force release for the KDP profile or refuse to export a draft with a clear error.

### V — Validation gate
Kindle Previewer is Amazon's authoritative check but is GUI/proprietary and hard to run in CI.
- **CI (automatable):** add **`epubcheck`** (open-source EPUB validator) against the `kdp`-profile output — catches OPF/nav/manifest/structural errors. Not Kindle-specific but a strong structural gate.
- **Pre-ship (manual):** run the artifact through **Kindle Previewer** once before relying on the profile; document in the compiler README.

## Effort / shape
- **Net-new:** D1 (4-layer plumbing), D2 (css variant), D3 (math raster — the heavy one), D4 (diagram raster). **Modification:** D5 (cover, reuse), D6 (mostly small — ISO-date + translator role in `buildOpf`, a release guard; the `author`-capture piece may be a mobile-side change). Validation: epubcheck in CI + a manual Kindle-Previewer note.
- D3 and D4 share the Chromium-screenshot mechanics already in `coverRaster.ts`/`mermaid.ts` — build one small `rasterize(svgOrEl) → PNG` helper and reuse it for math, diagrams, and the cover.
- PDF path untouched.

## Open questions
1. **UX:** a distinct "Export for Kindle (KDP)" action, or a checkbox on the existing export? (Recommend a distinct action — it produces a *different* artifact, and pairs with the AI-disclosure reminder from #336-A.)
2. **Validation:** epubcheck-in-CI acceptable as the automated gate, with Kindle Previewer as a documented manual step?
3. **Accessibility stance:** raster math drops MathML semantics (keeps LaTeX alt). Acceptable trade for Kindle reliability, and reflect it in `accessibilityMeta()` for the profile?

## Non-goals
- **MOBI/AZW** — deprecated by KDP (Mar 2025), not built here.
- **KDP paperback / PDF interior** specs (trim, bleed, margins) — separate print target.
- **Auto-submission to KDP** — no public publish API; the author uploads the artifact + answers the AI-disclosure question (#336-A) themselves.
