# Format templates: PDF print and EPUB

Reference settings for the two book outputs, as currently shipped. Use these as the
starting point for any new book. Values are the source of truth in `compiler/src/`;
this doc records them and says which ones are locked by a test.

## PDF (print)

Source: `compiler/src/pdf.ts` (`pdfCss()`, `floatChapterNumber()`). Rendered with
Vivliostyle + Chrome (`compiler/src/pdfRender.ts`).

### Page

| Setting | Value |
|---|---|
| Trim size | 190.5 × 234.95 mm (7.5 × 9.25 in) |
| Page background | `#faf8f3` (warm ivory) |
| Verso margins (left pages) | top 22 · right 26 · bottom 24 · left 20 mm |
| Recto margins (right pages) | top 22 · right 20 · bottom 24 · left 26 mm |
| Front matter | roman page numbers, own page size and margins |

### Running heads

| Setting | Value |
|---|---|
| Font | Liberation Sans, Helvetica Neue, Arial, sans-serif |
| Size, colour | 8.5 pt, `#555` |
| Verso | page number top-left, book title bottom-centre |
| Recto | chapter title top-left, page number top-right, book title bottom-centre |

### Text

| Setting | Value |
|---|---|
| Body | Liberation Serif, Georgia, Times New Roman, serif · 10.5 pt · line-height 1.45 |
| Headings | Playfair Display (sans fallback) · h1 1.6em · h2 1.25em · h3 1.08em |
| Paragraphs | first-line indent 1.3em · orphans 3 · widows 3 |
| Inline code | Courier New · 0.9em · `#f3f3f3` background |
| Tables | full width · header gold, white text · zebra rows `#f4f1ea` · no split across pages |

### Diagrams and figures (locked, #623)

| Setting | Value |
|---|---|
| Width | 100% of text column |
| Max height | 150 mm |
| Frame | 1 px `#b8b8b8` border, 3 mm padding, white background |
| Splitting | `break-inside: avoid` (never split across pages) |
| Caption | gold, 0.85em, left-aligned, below the figure |
| Numbering | per Anuvaka (`floatChapterNumber`, #620): Figure 4.1 = first figure in Anuvaka 4 |
| Layout for tall flowcharts | two rows (3 + 2 boxes), transparent row groups, no grey background |

### Page flow (locked, #621, #622)

| Rule | Purpose |
|---|---|
| Each chapter starts on a new page (`break-before: page`) | clean chapter starts |
| Empty blocks inside chapters are hidden | no blank pages at chapter ends |
| A chapter's final horizontal rule is hidden | no stray rule at a page bottom |
| `p:has(> strong:only-child)` keeps with next (`break-after: avoid`) | bold labels (e.g. "Anuvāka 4") never stranded at a page bottom |

### Lock

`compiler/__tests__/pdfFormatLock.test.ts` fails if the diagram sizing or the page rules
change. A deliberate change means updating that test in the same PR.

## EPUB (reflowable)

Source: `compiler/src/css.ts` (`STYLESHEET`, the default profile), `compiler/src/epub.ts`,
`compiler/src/cover.ts`. Chosen with `compile ... --format epub --profile <name>`
(`compiler/src/cli.ts`).

### Profiles

| Profile | Use | What differs |
|---|---|---|
| `default` | general EPUB | embedded fonts; full stylesheet |
| `kdp` | Amazon KDP upload | separate stylesheet; body font not forced (KDP rule); raster cover page; see `docs/specs/kdp-clean-export-profile.md` |
| `epub2` | EPUB 2.0 readers (e.g. older viewers) | EPUB 2.0 package; XHTML 1.1 doctype and namespace on chapters and cover |

### Text (default profile)

| Setting | Value |
|---|---|
| Body | Serif stack · line-height 1.45 · justified · hyphens auto · 1 em padding |
| Headings | Playfair Display (sans fallback) · weight 500 · no synthetic bold · h1 1.6em · h2 1.3em · h3 1.1em · h4 1em · left-aligned |
| Code | Courier New · 0.9em |
| Tables | full width · header gold, white bold text · left-aligned |
| Images | `max-width: 100%`, block, centred |

### Diagrams and figures (default profile)

| Setting | Value |
|---|---|
| Block | centred · margin 1.4em vertical · figure counter increments |
| SVG | `max-width: 100%`, height auto |
| Caption | gold, 0.85em, sans |
| Placeholder (diagram not rendered) | grey background, pre-wrapped source text |

### Lock

No EPUB lock test yet. If EPUB settings need freezing, add a test like
`compiler/__tests__/pdfFormatLock.test.ts` against `STYLESHEET`.

## Changing a template

1. Change the value in `compiler/src/pdf.ts` or `compiler/src/css.ts`.
2. Update this doc in the same PR.
3. If the value is locked, update its test in the same PR.
4. Re-export one sample book and check the affected pages before merging.
