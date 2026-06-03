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
was condensed to ~1/3, the pedagogical back-matter was stripped, the 14 vector
chapter diagrams were replaced with 5 raster infographics + a redesigned cover
(the cover keeps the MENTIBLE logo), and PDF accessibility tagging was lost.

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
| 19 | Branding | "MENTIBLE · AUTHOR'S EDITION" cover + "Compiled with Mentible" colophon + © line | **cover keeps the MENTIBLE wordmark/logo**; colophon + inner branding gone (inner title: "LinkedIn Edition · 2026") | partial — colophon stripped, cover logo kept |
| 20 | Cover | generated Editorial SVG cover (indigo; green check→arrow mark) | **raster** cover (1056×1408) — dark-navy node-network motif, **retains the MENTIBLE wordmark/logo** | redesigned, branding retained |

## What manus.ai effectively did

- **Kept:** the 14-chapter structure, titles, ordering, TOC, and per-chapter
  Learning Objectives.
- **Removed:** every "Key Takeaways" and "Further Reading" section, the Mentible
  colophon + inner branding, and PDF tagging. (The **cover keeps** the MENTIBLE
  wordmark/logo — it's baked into the new raster cover.)
- **Condensed:** the body prose to roughly a third — unevenly (Ch.1 lightly
  trimmed, Ch.13 cut ~70%), i.e. it summarized, not just reformatted.
- **Added:** 6 large raster illustrations (a new cover + 5 chapter visuals),
  which account for almost all of the 10× file-size growth — note that's *fewer*
  than the book's ~14 per-chapter key visuals, so it substituted its own art
  rather than carrying the originals over.
- **Switched** the typographic engine (Vivliostyle → WeasyPrint) and font stack,
  losing the math/mono/emoji faces.

## Illustrations — itemized comparison

Side-by-side render: [`manus_vs_mentible_figures.png`](manus_vs_mentible_figures.png)
(Mentible vector diagram, left; manus raster figure, right).

**Inventory**

| | Mentible (A) | manus.ai (B) |
|---|---|---|
| Graphics total | **14 figures** (Figure 1–14) | **6** = 1 cover + **5 figures** (Figure 1–5) |
| Coverage | ~1 diagram **per chapter**, throughout | only **~5 early concepts**; figures on pp. 1, 6, 9, 13, 24, 37 — all in the first ~37 of 42 pages; back chapters bare |
| Kind | **vector** Mermaid flowcharts (0 raster) | **raster** RGB (2560×1440, ~1.3–2.2 MB each) |
| Origin | brand-templated diagrams from the book source | AI-redrawn infographics + a redesigned cover |

**manus.ai's 6 graphics**

| # | Page | Title | What it shows |
|---|---|---|---|
| Cover | 1 | *Product Sense and AI* | dark-navy cover, glowing node-network motif + icons; keeps the **MENTIBLE** logo |
| Fig 1 | 6 | The Career Model Shift | two panels (Traditional vs AI-Native) + "THE SHIFT" arrow |
| Fig 2 | 9 | The Knowledge-to-Judgment Chain | Knowledge → Context → Judgment, 3 nodes |
| Fig 3 | 13 | The New T-Shaped Professional | 4 teal pills over a dark "Deep Domain Expertise" anchor |
| Fig 4 | 24 | Enterprise Context Layers (L1–L5) | 5 stacked colour bars + stability axis |
| Fig 5 | 37 | Three Flavours of Enterprise AI | 3 columns (Assistants/Agents/Platforms) + "Match the Tool to the Job" |

**Mentible's 14 figures** — one per chapter, all brand-coloured Mermaid flowcharts
(pale lavender boxes, indigo `#312a8c` anchors, green accents), rendered inline as
small vector diagrams: 1 Why Experienced Professionals Are Worried · 2 Why
Experience Still Matters · 3 The New T-Shaped Professional · 4 From Expert to
Context Architect · 5 Why AI Fails · 6 What Is Context Engineering? · 7 Enterprise
Context Layers · 8 Why Requirements Fail · 9 What Is Spec-Driven Development? ·
10 The SDD Lifecycle · 11 Product Managers as Context Architects · 12 Human
Judgment Still Wins · 13 Understanding the AI Tool Landscape · 14 Staying Relevant
for the Next Decade. *(The source's 15th visual — "Claude, GitHub Copilot &
Microsoft Copilot" — never rendered; the known ch14 generation gap, not a manus
difference.)*

**Style — why manus looks more "radiant"**

| Aspect | Mentible (A) | manus.ai (B) |
|---|---|---|
| Palette | pale lavender, thin indigo borders on white — muted/utilitarian | saturated **teal/cyan + deep navy**, high contrast — vivid |
| Design | schematic line-art flowcharts | designed **flat infographics** — icons, pills, captions, depth |
| Size on page | small, embedded in the text column | large, near full-width landscape |
| Format | **vector** → crisp at any zoom, ~0 KB | **raster** → fixed 2560×1440, ~10 MB total |
| Coverage | every chapter | front-loaded; later chapters bare |
| Trade-off | consistent, complete, scalable, searchable, **tagged** | polished per-figure, but fewer, non-scalable, non-searchable, untagged |

**Net:** manus re-illustrated the early concepts as polished, high-contrast
infographics (the "radiance" = bright teal on navy, icons, depth, full-width
sizing) and redesigned the cover — while dropping ~9 of the 14 chapter diagrams.
A polish-per-figure win for manus, traded against coverage, scalability, file
size, searchability, and accessibility, which favour Mentible.

## Caveats

- Word counts are from `pdftotext` extraction (approximate; ignores any text
  baked into the 6 images).
- **Correction to an earlier draft:** the Mentible branding is **not fully
  stripped** — the manus cover keeps the MENTIBLE wordmark/logo (baked into the
  raster, so the text layer didn't show it); only the colophon + inner branding
  are gone.
- Item 18 (math/code) is inferred from the absent font faces, not a content diff.
- This compares the *PDF renderings*; manus's intermediate text wasn't available,
  so exact cut locations weren't traced.
