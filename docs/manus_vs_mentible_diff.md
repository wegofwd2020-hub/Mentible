# Mentible vs manus.ai — PDF comparison

Comparison of the original Mentible-compiled PDF against the version produced
after running it through [manus.ai](https://manus.ai/).

- **A — Mentible original:** `product-sense-and-ai-a-practical-guide-for-experienced-profe.pdf`
- **B — manus.ai output:** `product_sense_and_ai_book (1).pdf`

Method: text/fonts/images/metadata extracted with poppler
(`pdfinfo` · `pdftotext` · `pdffonts` · `pdfimages`); per-chapter body lengths
spot-verified. Generated 2026-06-03.

## Headline

manus.ai did **not** just re-lay-out the PDF — it **re-authored and re-designed**
it. The 14-chapter skeleton, TOC, and learning objectives survive, but the prose
was condensed to ~1/3, the pedagogical back-matter was stripped, the vector
diagrams + Mentible branding were replaced with raster illustrations, and PDF
accessibility tagging was lost.

## Table of differences

| # | Dimension | A — Mentible original | B — manus.ai output | Δ |
|---|---|---|---|---|
| 1 | File | `…-experienced-profe.pdf` | `product_sense_and_ai_book (1).pdf` | — |
| 2 | File size | 1.21 MB | **11.62 MB** | ~9.6× larger |
| 3 | Pages | **111** | **42** | −62% |
| 4 | Render engine | Vivliostyle.js 2.43 / Skia-PDF | **WeasyPrint 68.1** | different toolchain |
| 5 | Title (metadata) | "Product Sense and AI: A Practical Guide for Experienced Professionals…" | "Product Sense and AI" | subtitle dropped |
| 6 | Page size | A4 (595×842) | A4 (595×842) | same |
| 7 | **Tagged / accessible** | **yes** | **no** | ♿ regression |
| 8 | Chapters | 14 (titles + order) | 14 (same titles + order) | preserved |
| 9 | Table of contents | yes (leader dots + page #s) | yes (titles + page #s) | preserved |
| 10 | Learning objectives | 14 / 14 chapters | 14 / 14 chapters | preserved |
| 11 | **Key Takeaways** sections | **11** | **0** | removed |
| 12 | **Further Reading** sections | **11** | **0** | removed |
| 13 | Body text (words) | **~29,630** | **~9,390** | **−68%** |
| 14 | Ch.1 body | 2,179 w | 1,481 w | −32% |
| 15 | Ch.13 body | 1,539 w | 450 w | −71% (variable) |
| 16 | Raster images | **0** (diagrams were vector) | **6** (1× 1056×1408 portrait + 5× 2560×1440 landscape) | added; drives the size |
| 17 | Fonts | Source Serif 4, Liberation (Sans/Serif/Mono), **NotoSansMath, NotoSansMono, NotoColorEmoji** | Nimbus Sans, Liberation Serif, DejaVu Sans | no math/mono/emoji faces |
| 18 | Math / code / emoji glyph support | embedded | likely dropped (no math/mono fonts) | inferred |
| 19 | Branding | "MENTIBLE · AUTHOR'S EDITION" cover + "Compiled with Mentible" colophon + © line | none (inner title: "LinkedIn Edition · 2026") | Mentible stripped |
| 20 | Cover | generated Editorial SVG cover | raster image cover (the 1056×1408 image) | replaced |

## What manus.ai effectively did

- **Kept:** the 14-chapter structure, titles, ordering, TOC, and per-chapter
  Learning Objectives.
- **Removed:** every "Key Takeaways" and "Further Reading" section, the Mentible
  cover/colophon/branding, and PDF tagging.
- **Condensed:** the body prose to roughly a third — unevenly (Ch.1 lightly
  trimmed, Ch.13 cut ~70%), i.e. it summarized, not just reformatted.
- **Added:** 6 large raster illustrations (a new cover + 5 chapter visuals),
  which account for almost all of the 10× file-size growth — note that's *fewer*
  than the book's ~14 per-chapter key visuals, so it substituted its own art
  rather than carrying the originals over.
- **Switched** the typographic engine (Vivliostyle → WeasyPrint) and font stack,
  losing the math/mono/emoji faces.

## Caveats

- Word counts are from `pdftotext` extraction (approximate; ignores any text
  baked into the 6 images).
- Item 18 (math/code) is inferred from the absent font faces, not a content diff.
- This compares the *PDF renderings*; manus's intermediate text wasn't available,
  so exact cut locations weren't traced.
