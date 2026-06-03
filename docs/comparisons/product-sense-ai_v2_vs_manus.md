# Product Sense and AI — current Mentible build vs manus.ai

A follow-up to [`manus_vs_mentible_diff.md`](manus_vs_mentible_diff.md). That first
comparison measured the **original** Mentible PDF against the manus.ai re-process.
This compares the **current** Mentible build — after the diagram-theming upgrade,
a deliberate prose-condense pass, and a print-styling pass that adopted manus's
fonts and an airy layout — against the same manus.ai output.

- **A — Mentible (current):** `product-sense-and-ai.pdf` (compiled from
  `artifacts/product-sense-and-ai.book.json`, `--mermaid`)
- **B — manus.ai:** `product_sense_and_ai_book (1).pdf`

Method: poppler (`pdfinfo` · `pdftotext` · `pdffonts` · `pdfimages`). Generated 2026-06-03.

## Headline

The two books have **converged** on readability, length, and typography — that was
the goal of the latest passes. Mentible now reads as airily as manus, at a
comparable word count, in the same font families. What separates them is now
structural, and favours Mentible: **15 branded vector infographics vs 5 raster**,
**Further Reading on every chapter vs one**, **accessibility tagging**, and a file
**~24× smaller**. Key Takeaways, once thought dropped by manus, are present in both.

## Scorecard

| # | Dimension | A — Mentible (current) | B — manus.ai | Winner |
|---|---|---|---|---|
| 1 | Pages | 48 | 42 | ~tie |
| 2 | Extracted words | 12,475 | 9,388 | ~tie (Mentible carries more back-matter) |
| 3 | Words / page (density) | ~259 | ~241 | ~tie (both airy) |
| 4 | **File size** | **0.48 MB** | 11.62 MB | **A (~24× smaller)** |
| 5 | **Figures** | **15** (Figure 1–15) | 5 + cover | **A (3×)** |
| 6 | **Figure format** | **vector SVG** (0 raster) | **raster** (6 images, ≤2560×1440) | **A (scalable, tiny)** |
| 7 | **Tagged / accessible** | **yes** | no | **A** ♿ |
| 8 | Learning Objectives | 15 / 15 | 14 | ~tie |
| 9 | Key Takeaways | 15 / 15 | **14** (designed callouts) | ~tie |
| 10 | **Further Reading** | **15 / 15** | **1** | **A** |
| 11 | Monospace / code support | Liberation Mono | none | A |
| 12 | Render engine | Vivliostyle / Skia | WeasyPrint 68.1 | — |

## Where they converged (by design)

- **Length & density.** Mentible's prose was condensed ~43% (≈16.3k → 9.2k body
  words) to match manus's brevity, then the print layout was loosened (line-height
  1.55, 20 mm margins, 11 pt) so it breathes. Result: **~259 words/page vs manus's
  ~241** — both read airy, not dense.
- **Typography.** Mentible's PDF now uses **manus's font families** — **Liberation
  Serif** body + **Nimbus Sans** headings — and keeps **Liberation Mono** for code
  (manus embeds no monospace). See the font table below.
- **Key Takeaways.** *Correction to the first comparison:* manus did **not** drop
  Key Takeaways — it re-styled them as designed callouts (14/14 chapters). Both
  books now present Key Takeaways as branded callout panels.

## Where Mentible wins

- **Visuals.** 15 branded, role-coloured vector infographics (indigo `concept` /
  teal `decision` / green `success` / amber `warn` / lavender `process`), one per
  chapter — vs manus's 5 raster figures (front-loaded; later chapters bare). Vector
  means crisp at any zoom and a few KB each.
- **File size.** manus's 6 raster images are ~95% of its 11.6 MB; Mentible's entire
  PDF — text, 15 diagrams, cover — is **0.48 MB**.
- **Back-matter.** Further Reading on every chapter (manus: 1).
- **Accessibility & search.** Tagged PDF, fully selectable/searchable text; manus is
  untagged and its figure text is locked in raster.

## Font comparison

All fonts in both PDFs are embedded + subset (no system-font dependency).

| Role | A — Mentible (current) | B — manus.ai |
|---|---|---|
| Body serif | **Liberation Serif** | Liberation Serif |
| Sans (headings/labels) | **Nimbus Sans** | Nimbus Sans |
| Monospace (code) | **Liberation Mono** | — *(none)* |
| Fallback | Liberation Sans (diagram labels) | DejaVu Sans |

Mentible deliberately adopted manus's serif+sans pairing, so the body and heading
type now match. The remaining font differences are additive on Mentible's side:
**Liberation Mono** for code, and **Liberation Sans** in the diagram labels (from
the Mermaid theme).

## Caveats

- Word counts are `pdftotext` extractions (approximate; ignore text baked into
  manus's raster images; include Mentible's headings/objectives/takeaways/further).
- **Correction vs the first comparison doc:** manus retains Key Takeaways (re-styled
  callouts, 14/14) — the earlier "0" was a text-extraction miss on letter-spaced
  small-caps. manus *did* drop Further Reading (1 remaining).
- The 48-page / airy figures reflect the condensed content + the loosened print
  layout (see the "print + EPUB styling" compiler change). A pre-condense, denser
  pass measured differently.
- This compares the *PDF renderings*; manus's intermediate text was not available.
